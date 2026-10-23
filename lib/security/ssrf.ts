import { lookup } from "node:dns/promises";
import net from "node:net";
import { getEnv } from "./env";

export class SsrfBlockedError extends Error {
  readonly status = 400;
  readonly code = "SSRF_BLOCKED";
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

function ipv4ToUint32(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let num = 0;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    num = ((num << 8) | n) >>> 0;
  }
  return num >>> 0;
}

function inCidr4(ipNum: number, baseIp: string, prefixLen: number): boolean {
  const baseNum = ipv4ToUint32(baseIp);
  if (baseNum === null) return false;
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return (ipNum & mask) >>> 0 === (baseNum & mask) >>> 0;
}

/**
 * Checks whether an IPv4 or IPv6 literal belongs to any private, loopback, link-local,
 * CGNAT, cloud metadata, multicast, broadcast, documentation, or reserved range.
 */
export function isBlockedIp(rawIp: string): boolean {
  const ip = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const version = net.isIP(ip);
  if (version === 0) return true;

  if (version === 4) {
    const num = ipv4ToUint32(ip);
    if (num === null) return true;
    return (
      inCidr4(num, "0.0.0.0", 8) || // Current network / unspecified
      inCidr4(num, "10.0.0.0", 8) || // RFC1918 private
      inCidr4(num, "100.64.0.0", 10) || // CGNAT (includes Alibaba metadata 100.100.100.200)
      inCidr4(num, "127.0.0.0", 8) || // Loopback
      inCidr4(num, "169.254.0.0", 16) || // Link-local & cloud metadata (169.254.169.254)
      inCidr4(num, "172.16.0.0", 12) || // RFC1918 private
      inCidr4(num, "192.0.0.0", 24) || // IETF protocol assignments
      inCidr4(num, "192.0.2.0", 24) || // TEST-NET-1
      inCidr4(num, "192.88.99.0", 24) || // 6to4 relay anycast
      inCidr4(num, "192.168.0.0", 16) || // RFC1918 private
      inCidr4(num, "198.18.0.0", 15) || // Benchmarking
      inCidr4(num, "198.51.100.0", 24) || // TEST-NET-2
      inCidr4(num, "203.0.113.0", 24) || // TEST-NET-3
      inCidr4(num, "224.0.0.0", 4) || // Multicast
      inCidr4(num, "240.0.0.0", 4) // Reserved & broadcast (255.255.255.255)
    );
  }

  // IPv6 checks
  if (ip === "::" || ip === "::1" || ip === "0:0:0:0:0:0:0:1" || ip === "0:0:0:0:0:0:0:0") {
    return true;
  }

  // Check IPv4-mapped IPv6 addresses: ::ffff:a.b.c.d or ::ffff:7f00:0001
  if (ip.startsWith("::ffff:")) {
    const tail = ip.slice("::ffff:".length);
    if (net.isIPv4(tail)) {
      return isBlockedIp(tail);
    }
    const hexParts = tail.split(":");
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0]!, 16);
      const lo = parseInt(hexParts[1]!, 16);
      if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
        const mappedV4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return isBlockedIp(mappedV4);
      }
    }
    return true;
  }

  // Unique local (fc00::/7 -> fc.. or fd.., including AWS IPv6 metadata fd00:ec2::254),
  // Link-local (fe80::/10), Multicast (ff00::/8), Documentation (2001:db8::/32)
  if (
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    ip.startsWith("fe8") ||
    ip.startsWith("fe9") ||
    ip.startsWith("fea") ||
    ip.startsWith("feb") ||
    ip.startsWith("ff") ||
    ip.startsWith("2001:db8:") ||
    ip.startsWith("2001:0db8:")
  ) {
    return true;
  }

  return false;
}

export interface SsrfValidationOptions {
  allowPrivateIps?: boolean;
}

export interface ValidatedTarget {
  parsed: URL;
  url: URL;
  pinnedIp: string;
  family: 4 | 6;
}

/**
 * Validates a URL for SSRF safety and resolves its hostname to a verified public IP.
 * Rejects if ANY DNS A/AAAA record resolves to a blocked IP range.
 */
export async function validateUrlTarget(
  rawUrl: string,
  optionsOrAllowPrivate?: boolean | SsrfValidationOptions,
): Promise<ValidatedTarget> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfBlockedError(`Unsupported protocol '${parsed.protocol}' (only http/https allowed)`);
  }

  if (parsed.username || parsed.password) {
    throw new SsrfBlockedError("URLs with embedded credentials are not allowed");
  }

  const allowPrivateOverride =
    typeof optionsOrAllowPrivate === "boolean"
      ? optionsOrAllowPrivate
      : optionsOrAllowPrivate?.allowPrivateIps;

  const allowPrivate =
    allowPrivateOverride !== undefined
      ? allowPrivateOverride
      : getEnv().CRAWLER_ALLOW_PRIVATE_IPS && getEnv().NODE_ENV !== "production";

  if (parsed.port && !allowPrivate) {
    const portNum = Number(parsed.port);
    if (portNum !== 80 && portNum !== 443) {
      throw new SsrfBlockedError(`Port ${parsed.port} is not allowed (only 80 and 443 allowed)`);
    }
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname) {
    throw new SsrfBlockedError("Missing hostname");
  }

  if (!allowPrivate && (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal"))) {
    throw new SsrfBlockedError(`Blocked internal hostname: ${hostname}`);
  }

  // Literal IP in URL
  const literalFamily = net.isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    if (!allowPrivate && isBlockedIp(hostname)) {
      throw new SsrfBlockedError(`Blocked private or reserved IP address: ${hostname}`);
    }
    return { parsed, url: parsed, pinnedIp: hostname, family: literalFamily };
  }

  // Resolve all DNS records and verify every single one is public
  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SsrfBlockedError(`Could not resolve DNS for hostname: ${hostname}`);
  }

  if (!records || records.length === 0) {
    throw new SsrfBlockedError(`No DNS records returned for hostname: ${hostname}`);
  }

  for (const rec of records) {
    if (!allowPrivate && isBlockedIp(rec.address)) {
      throw new SsrfBlockedError(
        `Hostname ${hostname} resolved to blocked IP address ${rec.address}`,
      );
    }
  }

  // Prefer IPv4 first for broadest local/cloud routing compatibility
  const chosen = records.find((r) => r.family === 4) ?? records[0]!;
  return {
    parsed,
    url: parsed,
    pinnedIp: chosen.address,
    family: chosen.family === 6 ? 6 : 4,
  };
}
