import { sha256Hex } from "@/lib/security/crypto";

export interface ExtractedLink {
  toUrl: string;
  anchor: string;
  rel: string;
  isInternal: boolean;
}

export interface ExtractedImage {
  src: string;
  alt: string | null;
  isHttpOnHttps: boolean;
}

export interface ParsedPageData {
  url: string;
  urlHash: string;
  finalUrl: string;
  statusCode: number;
  contentType: string;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robotsMeta: string | null;
  xRobots: string | null;
  hreflang: Array<{ lang: string; href: string }>;
  h1: string[];
  headings: Array<{ level: number; text: string }>;
  wordCount: number;
  textHash: string;
  links: ExtractedLink[];
  images: ExtractedImage[];
  mixedContentUrls: string[];
  schemaTypes: string[];
  schemaRaw: unknown[];
  schemaInvalidCount: number;
  hasViewport: boolean;
  lang: string | null;
  verifyMetaToken: string | null;
  detectedCms: string | null;
  bytes: number;
  ttfbMs: number;
  injectionFlag: boolean;
  injectionReasons: string[];
  summary: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  mdash: "—",
  ndash: "–",
};

export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = parseInt(entity.slice(2), 16);
      return !Number.isNaN(code) && code > 0 ? String.fromCodePoint(code) : full;
    }
    if (entity.startsWith("#")) {
      const code = parseInt(entity.slice(1), 10);
      return !Number.isNaN(code) && code > 0 ? String.fromCodePoint(code) : full;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? full;
  });
}

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex =
    /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(attrString)) !== null) {
    const key = m[1]!.toLowerCase();
    const val = m[2] ?? m[3] ?? m[4] ?? "";
    attrs[key] = decodeHtmlEntities(val.trim());
  }
  return attrs;
}

function stripTagsToText(htmlFragment: string): string {
  return decodeHtmlEntities(
    htmlFragment
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/**
 * Computes a 64-bit hex SimHash from normalized word 3-shingles for near-duplicate detection.
 */
export function computeSimHash64(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

  if (words.length === 0) return "0000000000000000";

  const weights = new Int32Array(64);
  const shingles: string[] = [];
  if (words.length < 3) {
    shingles.push(words.join(" "));
  } else {
    for (let i = 0; i <= words.length - 3; i++) {
      shingles.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    }
  }

  for (const shingle of shingles.slice(0, 1500)) {
    const digest = sha256Hex(shingle);
    const hi = parseInt(digest.slice(0, 8), 16) >>> 0;
    const lo = parseInt(digest.slice(8, 16), 16) >>> 0;
    for (let bit = 0; bit < 32; bit++) {
      weights[bit] = (weights[bit] ?? 0) + ((hi & (1 << bit)) !== 0 ? 1 : -1);
      weights[bit + 32] = (weights[bit + 32] ?? 0) + ((lo & (1 << bit)) !== 0 ? 1 : -1);
    }
  }

  let hiOut = 0;
  let loOut = 0;
  for (let bit = 0; bit < 32; bit++) {
    if (weights[bit]! > 0) hiOut = (hiOut | (1 << bit)) >>> 0;
    if (weights[bit + 32]! > 0) loOut = (loOut | (1 << bit)) >>> 0;
  }

  return hiOut.toString(16).padStart(8, "0") + loOut.toString(16).padStart(8, "0");
}

/**
 * Computes the 64-bit Hamming distance (0..64) between two 16-char hex SimHashes.
 */
export function hammingDistanceSimHash64(hashA: string, hashB: string): number {
  if (hashA.length !== 16 || hashB.length !== 16) return 64;
  const popcount32 = (n: number): number => {
    let x = n >>> 0;
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  };
  const hiA = parseInt(hashA.slice(0, 8), 16) >>> 0;
  const loA = parseInt(hashA.slice(8, 16), 16) >>> 0;
  const hiB = parseInt(hashB.slice(0, 8), 16) >>> 0;
  const loB = parseInt(hashB.slice(8, 16), 16) >>> 0;
  return popcount32(hiA ^ hiB) + popcount32(loA ^ loB);
}

const INJECTION_PATTERNS: Array<{ reason: string; regex: RegExp }> = [
  {
    reason: "Instruction override phrase ('ignore previous instructions')",
    regex: /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules)/i,
  },
  {
    reason: "System prompt spoofing ('system prompt:' / '<system>')",
    regex: /(?:<\s*system\s*>|system\s+prompt\s*:|you\s+are\s+now\s+in\s+developer\s+mode)/i,
  },
  {
    reason: "Tool call hijacking attempt ('call tool' / 'function_call')",
    regex: /(?:execute|invoke|call)\s+tool\s+[a-z_]+/i,
  },
];

export function detectPromptInjection(rawHtml: string, visibleText: string): {
  flagged: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  for (const pat of INJECTION_PATTERNS) {
    if (pat.regex.test(visibleText) || pat.regex.test(rawHtml)) {
      reasons.push(pat.reason);
    }
  }
  return { flagged: reasons.length > 0, reasons };
}

export function normalizeCrawlUrl(rawUrl: string, baseUrl?: string): string {
  try {
    const u = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    u.hash = "";
    // Remove trailing slash except for root `/`
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    return u.toString();
  } catch {
    return "";
  }
}

function collectJsonLdTypes(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdTypes(item, out);
    return;
  }
  const obj = node as Record<string, unknown>;
  const t = obj["@type"];
  if (typeof t === "string") out.add(t);
  else if (Array.isArray(t)) {
    for (const x of t) if (typeof x === "string") out.add(x);
  }
  if (Array.isArray(obj["@graph"])) {
    collectJsonLdTypes(obj["@graph"], out);
  }
}

export function detectCmsFromHtmlAndHeaders(
  html: string,
  headers: Record<string, string>,
): string | null {
  const poweredBy = (headers["x-powered-by"] || "").toLowerCase();
  if (poweredBy.includes("next.js") || /\/_next\/static\//i.test(html)) return "Next.js";
  if (/wp-content|wp-includes/i.test(html)) return "WordPress";
  if (/cdn\.shopify\.com/i.test(html)) return "Shopify";
  if (/data-wf-site|webflow/i.test(html)) return "Webflow";
  if (/content=["']Ghost/i.test(html)) return "Ghost";
  return null;
}

export function parseHtmlPage(params: {
  url: string;
  finalUrl: string;
  statusCode: number;
  contentType: string;
  headers: Record<string, string>;
  html: string;
  bytes: number;
  ttfbMs: number;
}): ParsedPageData {
  const { url, finalUrl, statusCode, contentType, headers, html, bytes, ttfbMs } = params;
  const normalizedSelf = normalizeCrawlUrl(finalUrl, finalUrl) ?? finalUrl;
  const urlHash = sha256Hex(normalizedSelf);
  const pageOriginHost = new URL(finalUrl).hostname.toLowerCase().replace(/^www\./, "");
  const isHttpsPage = finalUrl.startsWith("https://");

  // Extract <html lang="...">
  let lang: string | null = null;
  const htmlTagMatch = /<html\b([^>]*)>/i.exec(html);
  if (htmlTagMatch?.[1]) {
    const attrs = parseAttributes(htmlTagMatch[1]);
    if (attrs.lang) lang = attrs.lang;
  }

  // Extract JSON-LD before stripping scripts
  const schemaRaw: unknown[] = [];
  const schemaTypesSet = new Set<string>();
  let schemaInvalidCount = 0;
  const ldJsonRegex =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch: RegExpExecArray | null;
  while ((ldMatch = ldJsonRegex.exec(html)) !== null) {
    const rawJson = (ldMatch[1] ?? "").trim();
    if (!rawJson) continue;
    try {
      const parsed = JSON.parse(rawJson);
      schemaRaw.push(parsed);
      collectJsonLdTypes(parsed, schemaTypesSet);
    } catch {
      schemaInvalidCount++;
    }
  }

  // Strip comments, scripts, styles, noscript, template for structural & text extraction
  const cleanedHtml = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ");

  // Title
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(cleanedHtml);
  const title = titleMatch?.[1] ? stripTagsToText(titleMatch[1]) || null : null;

  // Meta tags
  let metaDescription: string | null = null;
  let robotsMeta: string | null = null;
  let hasViewport = false;
  let verifyMetaToken: string | null = null;

  const metaRegex = /<meta\b([^>]*)\/?>/gi;
  let metaMatch: RegExpExecArray | null;
  while ((metaMatch = metaRegex.exec(cleanedHtml)) !== null) {
    const attrs = parseAttributes(metaMatch[1] ?? "");
    const name = (attrs.name ?? attrs.property ?? "").toLowerCase();
    const content = attrs.content ?? "";
    if (name === "description" && !metaDescription) {
      metaDescription = content || null;
    } else if ((name === "robots" || name === "googlebot") && content) {
      robotsMeta = robotsMeta ? `${robotsMeta}, ${content}` : content;
    } else if (name === "viewport" && content) {
      hasViewport = true;
    } else if (name === "rankpilot-verify" && content) {
      verifyMetaToken = content;
    }
  }

  // Link tags: canonical and hreflang
  let canonical: string | null = null;
  const hreflang: Array<{ lang: string; href: string }> = [];
  const linkTagRegex = /<link\b([^>]*)\/?>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkTagRegex.exec(cleanedHtml)) !== null) {
    const attrs = parseAttributes(linkMatch[1] ?? "");
    const relTokens = (attrs.rel ?? "").toLowerCase().split(/\s+/);
    const href = attrs.href ? normalizeCrawlUrl(attrs.href, finalUrl) ?? attrs.href : "";
    if (relTokens.includes("canonical") && href && !canonical) {
      canonical = href;
    }
    if (relTokens.includes("alternate") && attrs.hreflang && href) {
      hreflang.push({ lang: attrs.hreflang.toLowerCase(), href });
    }
  }

  // Headings H1..H6 in document order
  const headings: Array<{ level: number; text: string }> = [];
  const h1: string[] = [];
  const headingRegex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = headingRegex.exec(cleanedHtml)) !== null) {
    const level = Number(hMatch[1]);
    const text = stripTagsToText(hMatch[2] ?? "");
    if (text) {
      headings.push({ level, text });
      if (level === 1) h1.push(text);
    }
  }

  // Links <a href="...">
  const links: ExtractedLink[] = [];
  const aRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let aMatch: RegExpExecArray | null;
  while ((aMatch = aRegex.exec(cleanedHtml)) !== null) {
    const attrs = parseAttributes(aMatch[1] ?? "");
    const rawHref = (attrs.href ?? "").trim();
    if (
      !rawHref ||
      rawHref.startsWith("#") ||
      rawHref.toLowerCase().startsWith("javascript:") ||
      rawHref.toLowerCase().startsWith("mailto:") ||
      rawHref.toLowerCase().startsWith("tel:")
    ) {
      continue;
    }
    const resolved = normalizeCrawlUrl(rawHref, finalUrl);
    if (!resolved) continue;
    const targetHost = new URL(resolved).hostname.toLowerCase().replace(/^www\./, "");
    const isInternal = targetHost === pageOriginHost;
    const anchor = stripTagsToText(aMatch[2] ?? "").slice(0, 200);
    links.push({
      toUrl: resolved,
      anchor,
      rel: (attrs.rel ?? "").toLowerCase(),
      isInternal,
    });
  }

  // Images <img ...> & mixed content check
  const images: ExtractedImage[] = [];
  const mixedContentUrls: string[] = [];
  const imgRegex = /<img\b([^>]*)\/?>/gi;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgRegex.exec(cleanedHtml)) !== null) {
    const attrs = parseAttributes(imgMatch[1] ?? "");
    const srcRaw = attrs.src ?? attrs["data-src"] ?? "";
    if (!srcRaw || srcRaw.startsWith("data:")) continue;
    const resolvedSrc = normalizeCrawlUrl(srcRaw, finalUrl) ?? srcRaw;
    const isHttpOnHttps = isHttpsPage && resolvedSrc.startsWith("http://");
    if (isHttpOnHttps) mixedContentUrls.push(resolvedSrc);
    images.push({
      src: resolvedSrc,
      alt: attrs.alt !== undefined ? attrs.alt : null,
      isHttpOnHttps,
    });
  }

  // Visible body text, word count, SimHash
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(cleanedHtml);
  const visibleText = stripTagsToText(bodyMatch?.[1] ?? cleanedHtml);
  const words = visibleText ? visibleText.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const textHash = computeSimHash64(visibleText);

  const injection = detectPromptInjection(html, visibleText);
  const xRobots = headers["x-robots-tag"] ?? null;
  const detectedCms = detectCmsFromHtmlAndHeaders(html, headers);

  const summary = [
    `URL: ${finalUrl} (HTTP ${statusCode})`,
    `Title (${title?.length ?? 0}c): ${title ?? "MISSING"}`,
    `Meta (${metaDescription?.length ?? 0}c): ${metaDescription ?? "MISSING"}`,
    `H1 (${h1.length}): ${h1.join(" | ") || "MISSING"}`,
    `Words: ${wordCount}, Internal links: ${links.filter((l) => l.isInternal).length}, Schema: ${Array.from(schemaTypesSet).join(",") || "none"}`,
  ].join(" · ");

  return {
    url: normalizeCrawlUrl(url, finalUrl) ?? url,
    urlHash,
    finalUrl: normalizedSelf,
    statusCode,
    contentType,
    title,
    metaDescription,
    canonical,
    robotsMeta,
    xRobots,
    hreflang,
    h1,
    headings,
    wordCount,
    textHash,
    links,
    images,
    mixedContentUrls,
    schemaTypes: Array.from(schemaTypesSet),
    schemaRaw,
    schemaInvalidCount,
    hasViewport,
    lang,
    verifyMetaToken,
    detectedCms,
    bytes,
    ttfbMs,
    injectionFlag: injection.flagged,
    injectionReasons: injection.reasons,
    summary,
  };
}
