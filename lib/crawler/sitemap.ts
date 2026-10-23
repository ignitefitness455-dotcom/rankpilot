import { safeFetchUrl, type SafeFetchOptions } from "./fetcher";

export interface ParsedSitemap {
  url: string;
  statusCode: number;
  validXml: boolean;
  isIndex: boolean;
  pageUrls: string[];
  childSitemaps: string[];
  error?: string;
}

/**
 * Parses an XML sitemap (`<urlset>`) or sitemap index (`<sitemapindex>`).
 */
export function parseSitemapXml(url: string, statusCode: number, xml: string): ParsedSitemap {
  if (statusCode < 200 || statusCode >= 300) {
    return {
      url,
      statusCode,
      validXml: false,
      isIndex: false,
      pageUrls: [],
      childSitemaps: [],
      error: `HTTP ${statusCode}`,
    };
  }

  const trimmed = xml.trim();
  const hasUrlset = /<urlset[\s>]/i.test(trimmed) && /<\/urlset\s*>/i.test(trimmed);
  const hasIndex = /<sitemapindex[\s>]/i.test(trimmed) && /<\/sitemapindex\s*>/i.test(trimmed);

  if (!hasUrlset && !hasIndex) {
    return {
      url,
      statusCode,
      validXml: false,
      isIndex: false,
      pageUrls: [],
      childSitemaps: [],
      error: "Missing <urlset> or <sitemapindex> root element",
    };
  }

  const locs: string[] = [];
  const locRegex = /<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = locRegex.exec(trimmed)) !== null) {
    const loc = (match[1] ?? "")
      .trim()
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    if (loc.startsWith("http://") || loc.startsWith("https://")) {
      locs.push(loc);
    }
  }

  return {
    url,
    statusCode,
    validXml: true,
    isIndex: hasIndex,
    pageUrls: hasUrlset ? Array.from(new Set(locs)) : [],
    childSitemaps: hasIndex ? Array.from(new Set(locs)) : [],
  };
}

/**
 * Discovers and parses sitemaps from robots.txt declarations or `/sitemap.xml`.
 */
export async function fetchAndParseSitemaps(
  origin: string,
  robotsSitemaps: string[],
  fetchOpts: SafeFetchOptions = {},
): Promise<{
  sitemaps: ParsedSitemap[];
  allPageUrls: string[];
}> {
  const candidates =
    robotsSitemaps.length > 0 ? [...robotsSitemaps] : [`${origin.replace(/\/$/, "")}/sitemap.xml`];
  const visited = new Set<string>();
  const sitemaps: ParsedSitemap[] = [];
  const pageUrls = new Set<string>();

  for (const sitemapUrl of candidates.slice(0, 5)) {
    if (visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);
    try {
      const res = await safeFetchUrl(sitemapUrl, fetchOpts);
      const parsed = parseSitemapXml(sitemapUrl, res.statusCode, res.body);
      sitemaps.push(parsed);
      for (const u of parsed.pageUrls) pageUrls.add(u);

      // Follow up to 3 child sitemaps if this is a sitemap index
      for (const childUrl of parsed.childSitemaps.slice(0, 3)) {
        if (visited.has(childUrl)) continue;
        visited.add(childUrl);
        try {
          const childRes = await safeFetchUrl(childUrl, fetchOpts);
          const childParsed = parseSitemapXml(childUrl, childRes.statusCode, childRes.body);
          sitemaps.push(childParsed);
          for (const u of childParsed.pageUrls) pageUrls.add(u);
        } catch (err) {
          sitemaps.push({
            url: childUrl,
            statusCode: 0,
            validXml: false,
            isIndex: false,
            pageUrls: [],
            childSitemaps: [],
            error: err instanceof Error ? err.message : "Failed to fetch child sitemap",
          });
        }
      }
    } catch (err) {
      sitemaps.push({
        url: sitemapUrl,
        statusCode: 0,
        validXml: false,
        isIndex: false,
        pageUrls: [],
        childSitemaps: [],
        error: err instanceof Error ? err.message : "Failed to fetch sitemap",
      });
    }
  }

  return {
    sitemaps,
    allPageUrls: Array.from(pageUrls),
  };
}
