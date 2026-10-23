import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { safeFetchUrl } from "@/lib/crawler/fetcher";
import {
  isBlockedIp,
  SsrfBlockedError,
  validateUrlTarget,
} from "@/lib/security/ssrf";

describe("SSRF Guard — IPv4, IPv6, Metadata, Scheme, and Redirect Matrix", () => {
  it("blocks loopback, unspecified, RFC1918 private, link-local, CGNAT, and cloud metadata IPv4 addresses", () => {
    const blockedV4 = [
      "0.0.0.0",
      "127.0.0.1",
      "127.255.255.254",
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.0.1",
      "192.168.255.254",
      "169.254.169.254", // AWS/GCP/Azure IMDS
      "169.254.1.1",
      "100.64.0.1", // CGNAT
      "100.100.100.200", // Alibaba metadata
      "192.0.2.1", // TEST-NET-1
      "198.51.100.1", // TEST-NET-2
      "203.0.113.1", // TEST-NET-3
      "224.0.0.1", // Multicast
      "255.255.255.255", // Broadcast
    ];

    for (const ip of blockedV4) {
      expect(isBlockedIp(ip), `Expected IPv4 ${ip} to be blocked`).toBe(true);
    }
  });

  it("allows public routable IPv4 and IPv6 addresses", () => {
    const allowed = [
      "93.184.216.34", // example.com
      "8.8.8.8",
      "1.1.1.1",
      "172.15.255.255", // outside 172.16/12
      "172.32.0.1", // outside 172.16/12
      "2606:2800:220:1:248:1893:25c8:1946", // public IPv6
    ];

    for (const ip of allowed) {
      expect(isBlockedIp(ip), `Expected public IP ${ip} to be allowed`).toBe(false);
    }
  });

  it("blocks IPv6 loopback, ULA, link-local, AWS IMDSv2 IPv6, and IPv4-mapped IPv6 bypasses", () => {
    const blockedV6 = [
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd12:3456:789a::1",
      "fd00:ec2::254", // AWS IPv6 metadata
      "ff02::1", // Multicast
      "2001:db8::1", // Documentation
      "::ffff:127.0.0.1", // IPv4-mapped loopback
      "::ffff:169.254.169.254", // IPv4-mapped IMDS
      "::ffff:10.0.0.1", // IPv4-mapped RFC1918
    ];

    for (const ip of blockedV6) {
      expect(isBlockedIp(ip), `Expected IPv6 ${ip} to be blocked`).toBe(true);
    }
  });

  it("rejects non-HTTP(S) schemes, embedded credentials, and literal metadata hostnames", async () => {
    const forbiddenUrls = [
      "file:///etc/passwd",
      "ftp://example.com/pub",
      "gopher://127.0.0.1:70",
      "javascript:alert(1)",
      "http://user:pass@example.com/",
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://localhost:3000/api/health",
    ];

    for (const url of forbiddenUrls) {
      await expect(
        validateUrlTarget(url, { allowPrivateIps: false }),
      ).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });

  it("blocks a redirect hop that attempts to pivot to a disallowed private/metadata IP", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/redirect-to-imds") {
        res.writeHead(302, {
          Location: "http://169.254.169.254/latest/meta-data/iam",
        });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      // Even if initial request is made against local server, redirect to 169.254.169.254 is blocked when allowPrivateIps=false
      await expect(
        safeFetchUrl(`http://127.0.0.1:${port}/redirect-to-imds`, {
          ssrfOptions: { allowPrivateIps: false },
        }),
      ).rejects.toBeInstanceOf(SsrfBlockedError);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
