import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { getEnv } from "@/lib/security/env";
import {
  validateUrlTarget,
  SsrfBlockedError,
  type SsrfValidationOptions,
} from "@/lib/security/ssrf";

export interface SafeFetchOptions {
  maxRedirects?: number;
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  allowPrivateIps?: boolean;
  ssrfOptions?: SsrfValidationOptions;
  userAgent?: string;
}

export interface RedirectHop {
  url: string;
  status: number;
}

export interface SafeFetchResult {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  headers: Record<string, string>;
  contentType: string;
  body: string;
  bodyText: string;
  bytes: number;
  ttfbMs: number;
  redirectChain: RedirectHop[];
}

interface SingleHopResponse {
  statusCode: number;
  headers: Record<string, string>;
  bodyBuffer: Buffer;
  ttfbMs: number;
}

function requestSingleHop(
  targetUrl: URL,
  pinnedIp: string,
  family: 4 | 6,
  options: Required<Pick<SafeFetchOptions, "timeoutMs" | "maxBytes" | "userAgent">> & {
    headers?: Record<string, string>;
  },
): Promise<SingleHopResponse> {
  return new Promise((resolvePromise, rejectPromise) => {
    const isHttps = targetUrl.protocol === "https:";
    const mod = isHttps ? https : http;
    const startedAt = performance.now();
    let ttfbMs = 0;

    const req = mod.request(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: `${targetUrl.pathname || "/"}${targetUrl.search || ""}`,
        method: "GET",
        servername: targetUrl.hostname.replace(/^\[|\]$/g, ""),
        headers: {
          "User-Agent": options.userAgent,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
          "Accept-Encoding": "gzip, deflate, br",
          Connection: "close",
          ...options.headers,
        },
        // Pin the DNS-validated IP at socket connect time to defeat DNS rebinding
        lookup: (_hostname, _opts, cb) => {
          cb(null, pinnedIp, family);
        },
      },
      (res) => {
        ttfbMs = Math.max(1, Math.round(performance.now() - startedAt));
        const normHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === "string") normHeaders[k.toLowerCase()] = v;
          else if (Array.isArray(v)) normHeaders[k.toLowerCase()] = v.join(", ");
        }

        const encoding = (normHeaders["content-encoding"] || "").toLowerCase();
        let stream: NodeJS.ReadableStream = res;
        if (encoding === "gzip" || encoding === "x-gzip") {
          stream = res.pipe(zlib.createGunzip());
        } else if (encoding === "deflate") {
          stream = res.pipe(zlib.createInflate());
        } else if (encoding === "br") {
          stream = res.pipe(zlib.createBrotliDecompress());
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;

        stream.on("data", (chunk: Buffer) => {
          totalBytes += chunk.byteLength;
          if (totalBytes > options.maxBytes) {
            req.destroy(new Error(`Response body exceeded max size of ${options.maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });

        stream.on("end", () => {
          resolvePromise({
            statusCode: res.statusCode ?? 0,
            headers: normHeaders,
            bodyBuffer: Buffer.concat(chunks),
            ttfbMs,
          });
        });

        stream.on("error", (err) => {
          rejectPromise(err);
        });
      },
    );

    req.setTimeout(options.timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${options.timeoutMs}ms`));
    });

    req.on("error", (err) => {
      rejectPromise(err);
    });

    req.end();
  });
}

/**
 * SSRF-safe URL fetcher with DNS IP pinning, manual redirect validation on every hop,
 * 5 MB body cap, 15s timeout, and TTFB timing.
 */
export async function safeFetchUrl(
  rawUrl: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const env = getEnv();
  const maxRedirects = opts.maxRedirects ?? 10;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const userAgent = opts.userAgent ?? env.CRAWLER_USER_AGENT;

  let currentUrl = rawUrl;
  const redirectChain: RedirectHop[] = [];

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const allowPrivate =
      opts.ssrfOptions?.allowPrivateIps !== undefined
        ? opts.ssrfOptions.allowPrivateIps
        : opts.allowPrivateIps;
    const { parsed, pinnedIp, family } = await validateUrlTarget(
      currentUrl,
      allowPrivate,
    );

    const hopRes = await requestSingleHop(parsed, pinnedIp, family, {
      timeoutMs,
      maxBytes,
      userAgent,
      headers: opts.headers,
    });

    const isRedirect =
      hopRes.statusCode >= 300 &&
      hopRes.statusCode < 400 &&
      Boolean(hopRes.headers["location"]);

    if (isRedirect) {
      if (hop === maxRedirects) {
        throw new Error(`Exceeded maximum redirect hops (${maxRedirects}) for ${rawUrl}`);
      }
      redirectChain.push({ url: parsed.toString(), status: hopRes.statusCode });
      const nextUrl = new URL(hopRes.headers["location"]!, parsed).toString();
      currentUrl = nextUrl;
      continue;
    }

    const contentType = (hopRes.headers["content-type"] || "application/octet-stream")
      .split(";")[0]!
      .trim()
      .toLowerCase();

    const bodyStr = hopRes.bodyBuffer.toString("utf8");
    return {
      requestedUrl: rawUrl,
      finalUrl: parsed.toString(),
      statusCode: hopRes.statusCode,
      headers: hopRes.headers,
      contentType,
      body: bodyStr,
      bodyText: bodyStr,
      bytes: hopRes.bodyBuffer.byteLength,
      ttfbMs: hopRes.ttfbMs,
      redirectChain,
    };
  }

  throw new SsrfBlockedError(`Unexpected redirect loop for ${rawUrl}`);
}
