import type { LinkGraphSummary } from "@/lib/crawler/linkgraph";
import {
  hammingDistanceSimHash64,
  normalizeCrawlUrl,
  type ParsedPageData,
} from "@/lib/crawler/parse";
import { checkAiBotAccess, type ParsedRobotsTxt } from "@/lib/crawler/robots";
import type { ParsedSitemap } from "@/lib/crawler/sitemap";
import type { Evidence, Finding } from "@/lib/schemas/finding";

export interface CwvMetricSnapshot {
  url: string;
  strategy: "mobile" | "desktop";
  source: "psi_lab" | "crux_field";
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  fcpMs: number | null;
  ttfbMs: number | null;
  perfScore: number | null;
}

export interface CrawledPageWithChain extends ParsedPageData {
  redirectChain: Array<{ url: string; status: number }>;
  rendered: boolean;
}

export interface AuditRuleContext {
  rootUrl: string;
  crawledAtIso: string;
  pages: CrawledPageWithChain[];
  robots: ParsedRobotsTxt;
  sitemaps: ParsedSitemap[];
  linkGraph: LinkGraphSummary;
  cwvSnapshots: CwvMetricSnapshot[];
}

export interface EvaluatedRuleFinding {
  finding: Finding;
  pageEvidenceMap: Map<string, Evidence[]>;
}

function addPageEvidence(
  map: Map<string, Evidence[]>,
  pageUrl: string,
  item: Evidence,
): void {
  const existing = map.get(pageUrl);
  if (existing) {
    existing.push(item);
  } else {
    map.set(pageUrl, [item]);
  }
}

function isIndexable200Html(page: CrawledPageWithChain): boolean {
  if (page.statusCode !== 200) return false;
  if (!page.contentType.toLowerCase().includes("html")) return false;
  const robotsCombined = `${page.robotsMeta ?? ""} ${page.xRobots ?? ""}`.toLowerCase();
  return !robotsCombined.includes("noindex");
}

/**
 * Evaluates all 40 deterministic SEO, Performance, Link Graph, and AI Search rules
 * against a completed crawl snapshot.
 */
export function evaluateAllAuditRules(ctx: AuditRuleContext): EvaluatedRuleFinding[] {
  const results: EvaluatedRuleFinding[] = [];
  const ts = ctx.crawledAtIso;
  const indexablePages = ctx.pages.filter(isIndexable200Html);

  const pushFinding = (
    finding: Omit<Finding, "evidence" | "affected_count">,
    evidenceList: Evidence[],
    pageMap: Map<string, Evidence[]>,
    affectedCount?: number,
  ) => {
    if (evidenceList.length === 0) return;
    results.push({
      finding: {
        ...finding,
        evidence: evidenceList.slice(0, 50),
        affected_count: affectedCount ?? (pageMap.size > 0 ? pageMap.size : evidenceList.length),
      },
      pageEvidenceMap: pageMap,
    });
  };

  // ============================================================================
  // 1. TECHNICAL RULES (TECH-*)
  // ============================================================================

  // TECH-HTTP-5XX
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of ctx.pages) {
      if (p.statusCode >= 500) {
        const item: Evidence = {
          url: p.url,
          observed: `HTTP ${p.statusCode} server error`,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "TECH-HTTP-5XX",
        category: "technical",
        severity: "critical",
        title: "Server error pages (5xx) detected",
        why_it_matters:
          "Search engines cannot crawl or index pages returning 5xx server errors, and persistent 5xx responses cause Google to drop URLs from the index.",
        fix: {
          steps: [
            "Inspect application logs for unhandled exceptions on the affected routes.",
            "Ensure database queries and upstream API calls have timeouts and fallbacks.",
            "Verify the URL returns HTTP 200 before requesting re-indexing in Search Console.",
          ],
          code_snippet: null,
          language: "text",
        },
        impact: 5,
        effort: 3,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // TECH-HTTP-4XX
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of ctx.pages) {
      if (p.statusCode >= 400 && p.statusCode < 500) {
        const item: Evidence = {
          url: p.url,
          observed: `HTTP ${p.statusCode} client error`,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "TECH-HTTP-4XX",
        category: "technical",
        severity: "critical",
        title: "Broken pages returning 4xx status codes",
        why_it_matters:
          "Pages returning 404 or 410 waste crawl budget, lose any accumulated link equity, and create dead ends for visitors and AI search crawlers.",
        fix: {
          steps: [
            "If the page moved permanently, configure a 301 redirect to the most relevant live URL.",
            "Update or remove any internal links pointing to the 4xx URL.",
            "Remove 4xx URLs from your XML sitemap.",
          ],
          code_snippet: `rewrite ^/old-page$ /new-page permanent;`,
          language: "nginx",
        },
        impact: 5,
        effort: 2,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // TECH-REDIRECT-CHAIN
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of ctx.pages) {
      const chainLen = p.redirectChain?.length ?? 0;
      const hasTemp = p.redirectChain?.some((hop) => hop.status === 302 || hop.status === 307);
      if (chainLen >= 2 || hasTemp) {
        const summary = p.redirectChain
          .map((h) => `${h.status} ${h.url}`)
          .concat([`${p.statusCode} ${p.finalUrl}`])
          .join(" -> ");
        const item: Evidence = {
          url: p.url,
          observed: `Redirect chain (${chainLen} hops): ${summary}`,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "TECH-REDIRECT-CHAIN",
        category: "technical",
        severity: "warning",
        title: "Redirect chains or temporary redirects detected",
        why_it_matters:
          "Multi-hop redirect chains add latency to every page load and can cause crawlers to stop following hops, while 302/307 redirects delay canonical consolidation.",
        fix: {
          steps: [
            "Replace multi-hop redirects with a single 301 redirect directly to the final destination URL.",
            "Update internal links so they link directly to the final canonical URL.",
          ],
          code_snippet: null,
          language: "text",
        },
        impact: 3,
        effort: 2,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // TECH-ROBOTS-MISSING
  if (!ctx.robots.exists) {
    const robotsUrl = `${ctx.rootUrl.replace(/\/$/, "")}/robots.txt`;
    const item: Evidence = {
      url: robotsUrl,
      observed: `robots.txt missing or invalid (HTTP ${ctx.robots.statusCode})`,
      source: "crawler",
      timestamp: ts,
    };
    pushFinding(
      {
        id: "TECH-ROBOTS-MISSING",
        category: "technical",
        severity: "warning",
        title: "Missing or unreachable robots.txt file",
        why_it_matters:
          "A valid robots.txt tells search and AI crawlers which paths to crawl and where to find your XML sitemap.",
        fix: {
          steps: [
            "Create a public /robots.txt file at the root of your domain.",
            "Include a Sitemap directive pointing to your primary XML sitemap.",
          ],
          code_snippet: `User-agent: *\nAllow: /\nSitemap: ${ctx.rootUrl.replace(/\/$/, "")}/sitemap.xml`,
          language: "text",
        },
        impact: 3,
        effort: 1,
        confidence: 1,
        is_estimate: false,
      },
      [item],
      new Map(),
      1,
    );
  }

  // TECH-ROBOTS-BLOCK-ALL
  if (ctx.robots.exists) {
    const wildcardGroup = ctx.robots.groups.find((g) => g.agents.includes("*"));
    const blocksRoot = wildcardGroup?.rules.some(
      (r) => r.type === "disallow" && r.pattern.trim() === "/",
    );
    if (blocksRoot) {
      const robotsUrl = `${ctx.rootUrl.replace(/\/$/, "")}/robots.txt`;
      const item: Evidence = {
        url: robotsUrl,
        observed: `User-agent: * has Disallow: / in robots.txt`,
        source: "crawler",
        timestamp: ts,
      };
      pushFinding(
        {
          id: "TECH-ROBOTS-BLOCK-ALL",
          category: "technical",
          severity: "critical",
          title: "robots.txt blocks all search engine crawlers",
          why_it_matters:
            "A wildcard Disallow: / prevents Google and all compliant search engines from crawling your entire website.",
          fix: {
            steps: [
              "Remove 'Disallow: /' under 'User-agent: *' in your /robots.txt file immediately.",
              "Only disallow private or admin routes such as /admin or /api.",
            ],
            code_snippet: `User-agent: *\nAllow: /\nDisallow: /admin/`,
            language: "text",
          },
          impact: 5,
          effort: 1,
          confidence: 1,
          is_estimate: false,
        },
        [item],
        new Map(),
        1,
      );
    }
  }

  // TECH-SITEMAP-MISSING
  {
    const validSitemaps = ctx.sitemaps.filter((s) => s.validXml);
    if (validSitemaps.length === 0) {
      const sitemapUrl =
        ctx.sitemaps[0]?.url ?? `${ctx.rootUrl.replace(/\/$/, "")}/sitemap.xml`;
      const reason = ctx.sitemaps[0]?.error ?? "No valid XML sitemap discovered";
      const item: Evidence = {
        url: sitemapUrl,
        observed: reason,
        source: "crawler",
        timestamp: ts,
      };
      pushFinding(
        {
          id: "TECH-SITEMAP-MISSING",
          category: "technical",
          severity: "warning",
          title: "Missing or invalid XML sitemap",
          why_it_matters:
            "XML sitemaps help search engines quickly discover new and updated pages, especially on sites with deep architecture.",
          fix: {
            steps: [
              "Generate a standards-compliant /sitemap.xml listing all canonical, indexable 200 URLs.",
              "Reference the sitemap URL in /robots.txt and submit it in Google Search Console.",
            ],
            code_snippet: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${ctx.rootUrl}</loc>\n  </url>\n</urlset>`,
            language: "html",
          },
          impact: 4,
          effort: 2,
          confidence: 1,
          is_estimate: false,
        },
        [item],
        new Map(),
        1,
      );
    }
  }

  // TECH-CANON-MISSING
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of indexablePages) {
      if (!p.canonical) {
        const item: Evidence = {
          url: p.url,
          observed: "Missing <link rel=\"canonical\"> tag in <head>",
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "TECH-CANON-MISSING",
        category: "technical",
        severity: "warning",
        title: "Indexable pages missing a canonical tag",
        why_it_matters:
          "Without a self-referencing canonical tag, URL parameters (like UTM tracking tags) can create duplicate content versions that dilute ranking signals.",
        fix: {
          steps: [
            "Add a self-referencing <link rel=\"canonical\"> tag inside the <head> of every indexable page.",
            "Always use absolute HTTPS URLs without tracking query parameters.",
          ],
          code_snippet: `<link rel="canonical" href="${ctx.rootUrl}" />`,
          language: "html",
        },
        impact: 4,
        effort: 1,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // TECH-CANON-MISMATCH
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    const pageByNormUrl = new Map(
      ctx.pages.map((p) => [normalizeCrawlUrl(p.url), p]),
    );
    for (const p of indexablePages) {
      if (!p.canonical) continue;
      const normSelf = normalizeCrawlUrl(p.url);
      const normCanon = normalizeCrawlUrl(p.canonical);
      if (normSelf !== normCanon) {
        const targetPage = pageByNormUrl.get(normCanon);
        const detail = targetPage
          ? `Canonical points to ${p.canonical} (HTTP ${targetPage.statusCode})`
          : `Canonical points to non-self URL ${p.canonical}`;
        const item: Evidence = {
          url: p.url,
          observed: detail,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "TECH-CANON-MISMATCH",
        category: "technical",
        severity: "warning",
        title: "Pages canonicalized to a different URL",
        why_it_matters:
          "When a page's canonical tag points to another URL, Google treats the current URL as a duplicate and will not index or rank it directly.",
        fix: {
          steps: [
            "Verify whether this page is intentionally a duplicate variant.",
            "If the page should rank on its own, update <link rel=\"canonical\"> to match its own URL.",
          ],
          code_snippet: null,
          language: "html",
        },
        impact: 4,
        effort: 2,
        confidence: 0.95,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // TECH-NOINDEX-KEY
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of ctx.pages) {
      if (p.statusCode !== 200) continue;
      const robotsCombined = `${p.robotsMeta ?? ""} ${p.xRobots ?? ""}`.toLowerCase();
      if (robotsCombined.includes("noindex")) {
        const item: Evidence = {
          url: p.url,
          observed: `Page has noindex directive (meta="${p.robotsMeta ?? "none"}", x-robots="${p.xRobots ?? "none"}")`,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "TECH-NOINDEX-KEY",
        category: "technical",
        severity: "warning",
        title: "Crawled pages excluded by noindex directive",
        why_it_matters:
          "Any page with a noindex meta tag or X-Robots-Tag header is completely dropped from Google Search and AI Overviews.",
        fix: {
          steps: [
            "Confirm whether each listed page is intentionally excluded from search engines.",
            "If the page should rank, remove 'noindex' from the <meta name=\"robots\"> tag or HTTP response headers.",
          ],
          code_snippet: `<meta name="robots" content="index, follow" />`,
          language: "html",
        },
        impact: 4,
        effort: 1,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // TECH-HTTPS-MISSING
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of ctx.pages) {
      if (p.finalUrl.startsWith("http://")) {
        const item: Evidence = {
          url: p.url,
          observed: `Final URL served over insecure HTTP: ${p.finalUrl}`,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "TECH-HTTPS-MISSING",
        category: "technical",
        severity: "critical",
        title: "Pages served over insecure HTTP instead of HTTPS",
        why_it_matters:
          "HTTPS is a confirmed Google ranking signal and browser security requirement; HTTP pages display 'Not Secure' warnings to users.",
        fix: {
          steps: [
            "Enable TLS/SSL certificates (e.g. via Let's Encrypt or Cloudflare).",
            "Configure a permanent 301 redirect from all HTTP requests to HTTPS.",
          ],
          code_snippet: `return 301 https://$host$request_uri;`,
          language: "nginx",
        },
        impact: 5,
        effort: 2,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // TECH-MIXED-CONTENT
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of ctx.pages) {
      if (p.mixedContentUrls.length > 0) {
        const item: Evidence = {
          url: p.url,
          observed: `${p.mixedContentUrls.length} insecure http:// sub-resource(s): ${p.mixedContentUrls.slice(0, 3).join(", ")}`,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "TECH-MIXED-CONTENT",
        category: "technical",
        severity: "warning",
        title: "Mixed content (HTTP assets loaded on HTTPS pages)",
        why_it_matters:
          "Browsers block or downgrade security warnings when HTTPS pages load scripts, stylesheets, or images over plain HTTP.",
        fix: {
          steps: [
            "Update all asset URLs (images, scripts, stylesheets) to use https://.",
            "Add Content-Security-Policy: upgrade-insecure-requests to your response headers.",
          ],
          code_snippet: `<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests" />`,
          language: "html",
        },
        impact: 3,
        effort: 1,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // TECH-VIEWPORT-MISSING
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of indexablePages) {
      if (!p.hasViewport) {
        const item: Evidence = {
          url: p.url,
          observed: "Missing <meta name=\"viewport\"> tag",
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "TECH-VIEWPORT-MISSING",
        category: "technical",
        severity: "critical",
        title: "Missing mobile viewport meta tag",
        why_it_matters:
          "Google uses mobile-first indexing; without a responsive viewport meta tag, pages render at desktop width on phones and fail mobile usability checks.",
        fix: {
          steps: [
            "Add the standard responsive viewport meta tag inside the <head> element of all pages.",
          ],
          code_snippet: `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
          language: "html",
        },
        impact: 5,
        effort: 1,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // TECH-LANG-MISSING
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of indexablePages) {
      if (!p.lang || !p.lang.trim()) {
        const item: Evidence = {
          url: p.url,
          observed: "Missing lang attribute on <html> element",
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "TECH-LANG-MISSING",
        category: "technical",
        severity: "info",
        title: "Missing HTML lang attribute",
        why_it_matters:
          "Declaring the document language on <html> helps search engines, translation tools, and screen readers interpret your content accurately.",
        fix: {
          steps: [
            "Add a valid BCP 47 language code (e.g., lang=\"en\" or lang=\"bn\") to the root <html> element.",
          ],
          code_snippet: `<html lang="en">`,
          language: "html",
        },
        impact: 2,
        effort: 1,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // TECH-HREFLANG-INVALID
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    const validHreflangRe = /^(x-default|[a-z]{2,3}(-[a-zA-Z]{2,4})?)$/;
    for (const p of indexablePages) {
      if (p.hreflang.length === 0) continue;
      const invalidCodes = p.hreflang.filter((h) => !validHreflangRe.test(h.lang));
      const hasSelf = p.hreflang.some(
        (h) => normalizeCrawlUrl(h.href) === normalizeCrawlUrl(p.url),
      );
      if (invalidCodes.length > 0 || !hasSelf) {
        const reason =
          invalidCodes.length > 0
            ? `Invalid hreflang code(s): ${invalidCodes.map((c) => c.lang).join(", ")}`
            : `Hreflang tags present (${p.hreflang.length}) but missing self-referencing hreflang link`;
        const item: Evidence = {
          url: p.url,
          observed: reason,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "TECH-HREFLANG-INVALID",
        category: "technical",
        severity: "warning",
        title: "Invalid hreflang code or missing self-referencing hreflang",
        why_it_matters:
          "Google ignores hreflang annotations if ISO language/region codes are malformed or if a page does not include a self-referencing hreflang link.",
        fix: {
          steps: [
            "Ensure every localized page includes a self-referencing <link rel=\"alternate\" hreflang=\"...\"> tag.",
            "Use valid ISO 639-1 language codes (e.g., 'en', 'bn', 'en-US') plus 'x-default'.",
          ],
          code_snippet: `<link rel="alternate" hreflang="en" href="${ctx.rootUrl}" />\n<link rel="alternate" hreflang="x-default" href="${ctx.rootUrl}" />`,
          language: "html",
        },
        impact: 3,
        effort: 2,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // TECH-SCHEMA-INVALID
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of indexablePages) {
      if (p.schemaInvalidCount > 0) {
        const item: Evidence = {
          url: p.url,
          observed: `${p.schemaInvalidCount} malformed JSON-LD <script type="application/ld+json"> block(s)`,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "TECH-SCHEMA-INVALID",
        category: "technical",
        severity: "warning",
        title: "Malformed JSON-LD structured data blocks",
        why_it_matters:
          "Syntax errors in JSON-LD prevent Google and AI engines from parsing your structured data, disqualifying the page from rich results.",
        fix: {
          steps: [
            "Fix JSON syntax errors (trailing commas, unescaped quotes) in your <script type=\"application/ld+json\"> blocks.",
            "Use RankPilot's Schema Generator module to produce validated JSON-LD.",
          ],
          code_snippet: null,
          language: "json-ld",
        },
        impact: 4,
        effort: 1,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // ============================================================================
  // 2. ON-PAGE RULES (ONPAGE-*)
  // ============================================================================

  // ONPAGE-TITLE-MISSING
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of indexablePages) {
      if (!p.title || !p.title.trim()) {
        const item: Evidence = {
          url: p.url,
          observed: "Missing or empty <title> tag",
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "ONPAGE-TITLE-MISSING",
        category: "on_page",
        severity: "critical",
        title: "Indexable pages missing a <title> tag",
        why_it_matters:
          "The <title> tag is the single strongest on-page relevance signal and forms the clickable headline in search results.",
        fix: {
          steps: [
            "Write a unique, descriptive <title> between 50 and 60 characters for each affected page.",
            "Place the primary target keyword near the beginning of the title.",
          ],
          code_snippet: `<title>Primary Keyword — Clear Value Proposition | Brand</title>`,
          language: "html",
        },
        impact: 5,
        effort: 1,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // ONPAGE-TITLE-SHORT
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of indexablePages) {
      if (p.title && p.title.length > 0 && p.title.length < 30) {
        const item: Evidence = {
          url: p.url,
          observed: `Title length is ${p.title.length} chars (< 30): "${p.title}"`,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "ONPAGE-TITLE-SHORT",
        category: "on_page",
        severity: "warning",
        title: "Page <title> tags are too short (< 30 characters)",
        why_it_matters:
          "Short titles under-utilize SERP real estate, miss secondary keyword opportunities, and often get rewritten by Google.",
        fix: {
          steps: [
            "Expand the <title> to 50–60 characters by adding context, primary benefit, and your brand name.",
          ],
          code_snippet: null,
          language: "html",
        },
        impact: 3,
        effort: 1,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // ONPAGE-TITLE-LONG
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of indexablePages) {
      if (p.title && p.title.length > 60) {
        const item: Evidence = {
          url: p.url,
          observed: `Title length is ${p.title.length} chars (> 60): "${p.title.slice(0, 80)}..."`,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "ONPAGE-TITLE-LONG",
        category: "on_page",
        severity: "info",
        title: "Page <title> tags exceed 60 characters",
        why_it_matters:
          "Titles longer than ~60 characters (~600px) are truncated with an ellipsis in Google search results, potentially cutting off key phrases.",
        fix: {
          steps: [
            "Trim the <title> to 50–60 characters while preserving the primary keyword near the front.",
          ],
          code_snippet: null,
          language: "html",
        },
        impact: 2,
        effort: 1,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // ONPAGE-TITLE-DUP
  {
    const byTitle = new Map<string, CrawledPageWithChain[]>();
    for (const p of indexablePages) {
      if (!p.title) continue;
      const key = p.title.trim().toLowerCase();
      const list = byTitle.get(key) ?? [];
      list.push(p);
      byTitle.set(key, list);
    }
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const [, group] of byTitle.entries()) {
      if (group.length > 1) {
        for (const p of group) {
          const item: Evidence = {
            url: p.url,
            observed: `Duplicate title shared across ${group.length} pages: "${p.title}"`,
            source: "crawler",
            timestamp: ts,
          };
          ev.push(item);
          addPageEvidence(pm, p.url, item);
        }
      }
    }
    pushFinding(
      {
        id: "ONPAGE-TITLE-DUP",
        category: "on_page",
        severity: "warning",
        title: "Duplicate <title> tags across multiple pages",
        why_it_matters:
          "Identical titles make it difficult for search engines to distinguish which page should rank for a query, causing keyword cannibalization.",
        fix: {
          steps: [
            "Write a unique <title> for each page reflecting its specific topic and search intent.",
          ],
          code_snippet: null,
          language: "html",
        },
        impact: 4,
        effort: 2,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // ONPAGE-META-MISSING
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of indexablePages) {
      if (!p.metaDescription || !p.metaDescription.trim()) {
        const item: Evidence = {
          url: p.url,
          observed: "Missing or empty <meta name=\"description\"> tag",
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "ONPAGE-META-MISSING",
        category: "on_page",
        severity: "warning",
        title: "Indexable pages missing a meta description",
        why_it_matters:
          "A compelling meta description improves organic click-through rate (CTR) by summarizing the page's value proposition in search results.",
        fix: {
          steps: [
            "Add a unique <meta name=\"description\"> between 120 and 155 characters to each affected page.",
          ],
          code_snippet: `<meta name="description" content="Clear 120-155 character summary explaining what the page solves and why users should click." />`,
          language: "html",
        },
        impact: 3,
        effort: 1,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // ONPAGE-META-SHORT
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of indexablePages) {
      if (p.metaDescription && p.metaDescription.length > 0 && p.metaDescription.length < 70) {
        const item: Evidence = {
          url: p.url,
          observed: `Meta description length is ${p.metaDescription.length} chars (< 70): "${p.metaDescription}"`,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "ONPAGE-META-SHORT",
        category: "on_page",
        severity: "info",
        title: "Meta descriptions are too short (< 70 characters)",
        why_it_matters:
          "Very short meta descriptions fail to give searchers enough context to click your result over competitors.",
        fix: {
          steps: [
            "Expand the meta description to 120–155 characters with a clear summary and call to action.",
          ],
          code_snippet: null,
          language: "html",
        },
        impact: 2,
        effort: 1,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // ONPAGE-META-LONG
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of indexablePages) {
      if (p.metaDescription && p.metaDescription.length > 160) {
        const item: Evidence = {
          url: p.url,
          observed: `Meta description length is ${p.metaDescription.length} chars (> 160)`,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "ONPAGE-META-LONG",
        category: "on_page",
        severity: "info",
        title: "Meta descriptions exceed 160 characters",
        why_it_matters:
          "Descriptions over ~160 characters are truncated in Google SERPs, cutting off your call-to-action.",
        fix: {
          steps: [
            "Tighten the meta description to 120–155 characters so the full message displays in SERPs.",
          ],
          code_snippet: null,
          language: "html",
        },
        impact: 2,
        effort: 1,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // ONPAGE-META-DUP
  {
    const byMeta = new Map<string, CrawledPageWithChain[]>();
    for (const p of indexablePages) {
      if (!p.metaDescription) continue;
      const key = p.metaDescription.trim().toLowerCase();
      const list = byMeta.get(key) ?? [];
      list.push(p);
      byMeta.set(key, list);
    }
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const [, group] of byMeta.entries()) {
      if (group.length > 1) {
        for (const p of group) {
          const item: Evidence = {
            url: p.url,
            observed: `Duplicate meta description shared across ${group.length} pages`,
            source: "crawler",
            timestamp: ts,
          };
          ev.push(item);
          addPageEvidence(pm, p.url, item);
        }
      }
    }
    pushFinding(
      {
        id: "ONPAGE-META-DUP",
        category: "on_page",
        severity: "warning",
        title: "Duplicate meta descriptions across multiple pages",
        why_it_matters:
          "Boilerplate meta descriptions across multiple URLs reduce CTR and prompt Google to auto-generate snippets from random page text.",
        fix: {
          steps: [
            "Write a distinct 120–155 character meta description tailored to each page's specific content.",
          ],
          code_snippet: null,
          language: "html",
        },
        impact: 3,
        effort: 2,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // ONPAGE-H1-MISSING
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of indexablePages) {
      if (p.h1.length === 0) {
        const item: Evidence = {
          url: p.url,
          observed: "0 <h1> tags found on page",
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "ONPAGE-H1-MISSING",
        category: "on_page",
        severity: "warning",
        title: "Indexable pages missing an <h1> heading",
        why_it_matters:
          "The <h1> heading defines the primary topic of the page for both readers and search engines.",
        fix: {
          steps: [
            "Add a single, descriptive <h1> heading at the top of the main content area.",
            "Include your primary target keyword naturally in the <h1>.",
          ],
          code_snippet: `<h1>Clear Main Topic Heading</h1>`,
          language: "html",
        },
        impact: 4,
        effort: 1,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // ONPAGE-H1-MULTIPLE
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of indexablePages) {
      if (p.h1.length > 1) {
        const item: Evidence = {
          url: p.url,
          observed: `${p.h1.length} <h1> tags found: ${p.h1.slice(0, 3).map((h) => `"${h}"`).join(", ")}`,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "ONPAGE-H1-MULTIPLE",
        category: "on_page",
        severity: "info",
        title: "Pages with multiple <h1> headings",
        why_it_matters:
          "Using a single <h1> and nesting subtopics under <h2>/<h3> creates a cleaner semantic outline for accessibility and AI extraction.",
        fix: {
          steps: [
            "Keep one primary <h1> per page and convert secondary <h1> tags into <h2> subheadings.",
          ],
          code_snippet: null,
          language: "html",
        },
        impact: 2,
        effort: 1,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // ONPAGE-HEADING-SKIP
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of indexablePages) {
      let skipObserved: string | null = null;
      for (let i = 1; i < p.headings.length; i++) {
        const prev = p.headings[i - 1]!;
        const curr = p.headings[i]!;
        if (curr.level > prev.level + 1) {
          skipObserved = `Heading level jumped from <h${prev.level}> ("${prev.text.slice(0, 40)}") to <h${curr.level}> ("${curr.text.slice(0, 40)}")`;
          break;
        }
      }
      if (skipObserved) {
        const item: Evidence = {
          url: p.url,
          observed: skipObserved,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "ONPAGE-HEADING-SKIP",
        category: "on_page",
        severity: "info",
        title: "Skipped heading hierarchy levels (e.g. H1 directly to H3)",
        why_it_matters:
          "Logical heading nesting (H1 -> H2 -> H3) helps screen readers navigate and helps AI engines parse section hierarchy.",
        fix: {
          steps: [
            "Adjust heading tags so levels increment by one step at a time (e.g., use <h2> before <h3>).",
          ],
          code_snippet: null,
          language: "html",
        },
        impact: 2,
        effort: 1,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // ONPAGE-IMG-ALT-MISSING
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of indexablePages) {
      const missingAlt = p.images.filter((img) => img.alt === null || img.alt.trim() === "");
      if (missingAlt.length > 0) {
        const item: Evidence = {
          url: p.url,
          observed: `${missingAlt.length} image(s) missing alt text (e.g. ${missingAlt[0]!.src})`,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "ONPAGE-IMG-ALT-MISSING",
        category: "on_page",
        severity: "warning",
        title: "Images missing descriptive alt attributes",
        why_it_matters:
          "Alt text is required for WCAG accessibility and allows Google Images and multimodal AI models to understand image content.",
        fix: {
          steps: [
            "Add concise, descriptive alt=\"...\" attributes to all informational <img> elements.",
          ],
          code_snippet: `<img src="/example.webp" alt="Concise description of what the image shows" />`,
          language: "html",
        },
        impact: 3,
        effort: 1,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // ONPAGE-SCHEMA-MISSING
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of indexablePages) {
      if (p.schemaTypes.length === 0 && p.schemaInvalidCount === 0) {
        const item: Evidence = {
          url: p.url,
          observed: "No JSON-LD structured data found on page",
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "ONPAGE-SCHEMA-MISSING",
        category: "on_page",
        severity: "info",
        title: "Pages without JSON-LD structured data",
        why_it_matters:
          "Structured data (Article, FAQPage, Product, Organization, SoftwareApplication) clarifies entities for Google Rich Results and AI search engines.",
        fix: {
          steps: [
            "Add appropriate JSON-LD schema markup in the <head> using RankPilot's Schema Generator.",
          ],
          code_snippet: `<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "WebPage",\n  "name": "Page Title"\n}\n</script>`,
          language: "json-ld",
        },
        impact: 3,
        effort: 2,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // ============================================================================
  // 3. CONTENT RULES (CONT-*)
  // ============================================================================

  // CONT-THIN-PAGE
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of indexablePages) {
      if (p.wordCount < 250) {
        const item: Evidence = {
          url: p.url,
          observed: `Low word count: ${p.wordCount} words (< 250 threshold)`,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "CONT-THIN-PAGE",
        category: "content",
        severity: "warning",
        title: "Thin content pages (< 250 words)",
        why_it_matters:
          "Pages with very little substantive text rarely satisfy search intent or provide enough entity depth to be cited in AI Overviews.",
        fix: {
          steps: [
            "Expand the page with direct answers, practical examples, FAQs, and original insights.",
            "Alternatively, consolidate thin pages into a comprehensive guide and 301 redirect the stub URL.",
          ],
          code_snippet: null,
          language: "text",
        },
        impact: 4,
        effort: 3,
        confidence: 0.9,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // CONT-NEAR-DUPLICATE
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    const substantialPages = indexablePages.filter((p) => p.wordCount >= 80);
    const flagged = new Set<string>();

    for (let i = 0; i < substantialPages.length; i++) {
      for (let j = i + 1; j < substantialPages.length; j++) {
        const a = substantialPages[i]!;
        const b = substantialPages[j]!;
        const dist = hammingDistanceSimHash64(a.textHash, b.textHash);
        if (dist <= 3) {
          if (!flagged.has(a.url)) {
            flagged.add(a.url);
            const itemA: Evidence = {
              url: a.url,
              observed: `Near-duplicate content with ${b.url} (SimHash Hamming distance = ${dist})`,
              source: "crawler",
              timestamp: ts,
            };
            ev.push(itemA);
            addPageEvidence(pm, a.url, itemA);
          }
          if (!flagged.has(b.url)) {
            flagged.add(b.url);
            const itemB: Evidence = {
              url: b.url,
              observed: `Near-duplicate content with ${a.url} (SimHash Hamming distance = ${dist})`,
              source: "crawler",
              timestamp: ts,
            };
            ev.push(itemB);
            addPageEvidence(pm, b.url, itemB);
          }
        }
      }
    }
    pushFinding(
      {
        id: "CONT-NEAR-DUPLICATE",
        category: "content",
        severity: "warning",
        title: "Near-duplicate content across indexable URLs",
        why_it_matters:
          "Pages with nearly identical body text compete against each other in search results and split ranking signals.",
        fix: {
          steps: [
            "Consolidate duplicate pages into one primary URL using a 301 redirect or canonical tag.",
            "If both pages must exist, differentiate their body copy to target distinct user intents.",
          ],
          code_snippet: null,
          language: "text",
        },
        impact: 4,
        effort: 3,
        confidence: 0.9,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // ============================================================================
  // 4. LINKS RULES (LINK-*)
  // ============================================================================

  // LINK-BROKEN-INTERNAL
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const broken of ctx.linkGraph.brokenInternalLinks) {
      const item: Evidence = {
        url: broken.fromUrl,
        observed: `Links internally to broken URL ${broken.toUrl} (HTTP ${broken.statusCode})`,
        source: "crawler",
        timestamp: ts,
      };
      ev.push(item);
      addPageEvidence(pm, broken.fromUrl, item);
    }
    pushFinding(
      {
        id: "LINK-BROKEN-INTERNAL",
        category: "links",
        severity: "critical",
        title: "Internal links pointing to broken (4xx/5xx) pages",
        why_it_matters:
          "Broken internal links frustrate users, waste crawler budget, and leak internal PageRank.",
        fix: {
          steps: [
            "Update each broken href on the source page to point to a live 200 URL, or remove the link.",
          ],
          code_snippet: null,
          language: "html",
        },
        impact: 5,
        effort: 1,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // LINK-ORPHAN-PAGE
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const orphanUrl of ctx.linkGraph.orphanUrls) {
      const item: Evidence = {
        url: orphanUrl,
        observed: "0 incoming internal links from other crawled pages (orphan page)",
        source: "crawler",
        timestamp: ts,
      };
      ev.push(item);
      addPageEvidence(pm, orphanUrl, item);
    }
    pushFinding(
      {
        id: "LINK-ORPHAN-PAGE",
        category: "links",
        severity: "warning",
        title: "Orphan pages with zero incoming internal links",
        why_it_matters:
          "Pages that receive zero internal links receive no internal authority and are rarely prioritized by search engines even if listed in a sitemap.",
        fix: {
          steps: [
            "Add contextual internal links to each orphan page from relevant high-authority pages or category hubs.",
          ],
          code_snippet: null,
          language: "html",
        },
        impact: 4,
        effort: 2,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // LINK-DEEP-PAGE
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const [url, metrics] of ctx.linkGraph.nodeMetrics.entries()) {
      if (metrics.depth !== null && metrics.depth > 3) {
        const item: Evidence = {
          url,
          observed: `Click depth is ${metrics.depth} hops from homepage (> 3 recommended max)`,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, url, item);
      }
    }
    pushFinding(
      {
        id: "LINK-DEEP-PAGE",
        category: "links",
        severity: "info",
        title: "Pages buried more than 3 clicks deep from homepage",
        why_it_matters:
          "Pages requiring 4+ clicks from the root URL are crawled less frequently and receive weaker internal link equity.",
        fix: {
          steps: [
            "Link to important deep pages from category hubs, topic clusters, or hub navigation.",
          ],
          code_snippet: null,
          language: "html",
        },
        impact: 3,
        effort: 2,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // LINK-GENERIC-ANCHOR
  {
    const genericSet = new Set([
      "click here",
      "read more",
      "learn more",
      "here",
      "more",
      "link",
      "this page",
    ]);
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of indexablePages) {
      const genericLinks = p.links.filter(
        (l) => l.isInternal && genericSet.has(l.anchor.trim().toLowerCase()),
      );
      if (genericLinks.length > 0) {
        const item: Evidence = {
          url: p.url,
          observed: `${genericLinks.length} internal link(s) use generic anchor text ("${genericLinks[0]!.anchor}" -> ${genericLinks[0]!.toUrl})`,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "LINK-GENERIC-ANCHOR",
        category: "links",
        severity: "info",
        title: "Internal links using non-descriptive anchor text",
        why_it_matters:
          "Descriptive anchor text tells search engines what the target page is about; generic phrases like 'click here' waste topical relevance signals.",
        fix: {
          steps: [
            "Replace generic anchors ('click here', 'read more') with natural, topic-specific phrases describing the destination page.",
          ],
          code_snippet: `<a href="/technical-seo-guide">complete technical SEO checklist</a>`,
          language: "html",
        },
        impact: 2,
        effort: 1,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // ============================================================================
  // 5. PERFORMANCE RULES (PERF-*)
  // ============================================================================

  // PERF-HTML-LARGE
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of indexablePages) {
      if (p.bytes > 250 * 1024) {
        const kb = Math.round(p.bytes / 1024);
        const item: Evidence = {
          url: p.url,
          observed: `HTML document size is ${kb} KB (> 250 KB threshold)`,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "PERF-HTML-LARGE",
        category: "performance",
        severity: "warning",
        title: "Oversized HTML documents (> 250 KB)",
        why_it_matters:
          "Bloated HTML payloads (often caused by inline base64 images or huge serialized state) slow down download and DOM parsing times.",
        fix: {
          steps: [
            "Externalize large inline SVGs, CSS, or JSON hydration payloads.",
            "Enable Brotli or Gzip compression on your origin server.",
          ],
          code_snippet: null,
          language: "text",
        },
        impact: 3,
        effort: 2,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // PERF-TTFB-SLOW
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of indexablePages) {
      if (p.ttfbMs > 800) {
        const item: Evidence = {
          url: p.url,
          observed: `Server TTFB measured at ${p.ttfbMs} ms (> 800 ms Google threshold)`,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "PERF-TTFB-SLOW",
        category: "performance",
        severity: "warning",
        title: "Slow server response time (TTFB > 800ms)",
        why_it_matters:
          "High Time to First Byte directly delays Largest Contentful Paint (LCP) and reduces how many pages Googlebot can crawl per minute.",
        fix: {
          steps: [
            "Cache public HTML responses at the CDN edge (`Cache-Control: s-maxage=3600, stale-while-revalidate`).",
            "Optimize slow database queries executed during server-side rendering.",
          ],
          code_snippet: null,
          language: "text",
        },
        impact: 4,
        effort: 3,
        confidence: 0.95,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // PERF-CWV-LCP
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const snap of ctx.cwvSnapshots) {
      if (snap.lcpMs !== null && snap.lcpMs > 2500) {
        const item: Evidence = {
          url: snap.url,
          observed: `${snap.strategy.toUpperCase()} LCP is ${Math.round(snap.lcpMs)} ms (> 2,500 ms Good threshold, source=${snap.source})`,
          source: "psi",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, snap.url, item);
      }
    }
    pushFinding(
      {
        id: "PERF-CWV-LCP",
        category: "performance",
        severity: ev.some((e) => e.observed.includes("4")) ? "critical" : "warning",
        title: "Core Web Vitals: Largest Contentful Paint (LCP) exceeds 2.5s",
        why_it_matters:
          "LCP measures perceived loading speed and is one of the three Core Web Vitals used in Google's page experience ranking system.",
        fix: {
          steps: [
            "Preload the hero LCP image with fetchpriority=\"high\" and avoid lazy-loading above-the-fold images.",
            "Serve modern image formats (AVIF/WebP) and reduce server TTFB.",
          ],
          code_snippet: `<img src="/hero.webp" alt="Hero" fetchpriority="high" decoding="async" />`,
          language: "html",
        },
        impact: 4,
        effort: 2,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // PERF-CWV-CLS
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const snap of ctx.cwvSnapshots) {
      if (snap.cls !== null && snap.cls > 0.1) {
        const item: Evidence = {
          url: snap.url,
          observed: `${snap.strategy.toUpperCase()} CLS is ${snap.cls.toFixed(3)} (> 0.100 Good threshold, source=${snap.source})`,
          source: "psi",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, snap.url, item);
      }
    }
    pushFinding(
      {
        id: "PERF-CWV-CLS",
        category: "performance",
        severity: "warning",
        title: "Core Web Vitals: Cumulative Layout Shift (CLS) exceeds 0.10",
        why_it_matters:
          "Unexpected layout shifts hurt user experience and fail Google's Core Web Vitals visual stability threshold.",
        fix: {
          steps: [
            "Always set explicit width and height attributes on <img> and <video> elements.",
            "Reserve fixed min-height containers for dynamic banners or embeds.",
          ],
          code_snippet: `<img src="/feature.webp" width="800" height="450" alt="Feature preview" />`,
          language: "html",
        },
        impact: 3,
        effort: 2,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  // ============================================================================
  // 6. AI SEARCH & SECURITY RULES (AI-*)
  // ============================================================================

  // AI-BOTS-BLOCKED
  if (ctx.robots.exists) {
    const botStatus = checkAiBotAccess(ctx.robots);
    const blockedBots = Object.entries(botStatus)
      .filter(([, entry]) => !entry.allowed)
      .map(([bot]) => bot);
    if (blockedBots.length > 0) {
      const robotsUrl = `${ctx.rootUrl.replace(/\/$/, "")}/robots.txt`;
      const item: Evidence = {
        url: robotsUrl,
        observed: `robots.txt disallows AI search crawlers: ${blockedBots.join(", ")}`,
        source: "crawler",
        timestamp: ts,
      };
      pushFinding(
        {
          id: "AI-BOTS-BLOCKED",
          category: "ai_search",
          severity: "warning",
          title: "AI search crawlers blocked in robots.txt",
          why_it_matters:
            "Blocking bots such as GPTBot, PerplexityBot, or Google-Extended can prevent your brand and content from being cited in ChatGPT Search, Perplexity, and Google AI Overviews.",
          fix: {
            steps: [
              "Review your robots.txt rules for GPTBot, PerplexityBot, ClaudeBot, and Google-Extended.",
              "Allow AI search crawlers on public marketing and documentation pages you want cited.",
            ],
            code_snippet: `User-agent: GPTBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\nUser-agent: Google-Extended\nAllow: /`,
            language: "text",
          },
          impact: 4,
          effort: 1,
          confidence: 1,
          is_estimate: false,
        },
        [item],
        new Map(),
        blockedBots.length,
      );
    }
  }

  // AI-PROMPT-INJECTION
  {
    const ev: Evidence[] = [];
    const pm = new Map<string, Evidence[]>();
    for (const p of ctx.pages) {
      if (p.injectionFlag) {
        const item: Evidence = {
          url: p.url,
          observed: `Suspicious instruction-override pattern detected in page text: ${p.injectionReasons.join(", ")}`,
          source: "crawler",
          timestamp: ts,
        };
        ev.push(item);
        addPageEvidence(pm, p.url, item);
      }
    }
    pushFinding(
      {
        id: "AI-PROMPT-INJECTION",
        category: "ai_search",
        severity: "critical",
        title: "Untrusted prompt-injection pattern flagged in page content",
        why_it_matters:
          "Adversarial prompt-injection strings embedded in user-generated content or comments can manipulate LLM summarizers and are quarantined by RankPilot's guardrails.",
        fix: {
          steps: [
            "Audit user-submitted comments, reviews, or hidden text on the flagged URL.",
            "Remove adversarial instruction overrides ('ignore previous instructions', fake system tags).",
          ],
          code_snippet: null,
          language: "text",
        },
        impact: 5,
        effort: 2,
        confidence: 1,
        is_estimate: false,
      },
      ev,
      pm,
    );
  }

  return results;
}
