import { normalizeCrawlUrl } from "@/lib/crawler/parse";

export interface CrawledPageNode {
  url: string;
  statusCode: number;
  internalOutlinks: string[];
  externalOutlinks: string[];
}

export interface ComputedNodeMetrics {
  url: string;
  depth: number | null; // null if unreachable from startUrl (orphan discovered via sitemap)
  inlinksCount: number;
  outlinksCount: number;
  isOrphan: boolean;
  brokenInternalOutlinks: string[];
}

export interface LinkGraphSummary {
  nodeMetrics: Map<string, ComputedNodeMetrics>;
  maxDepth: number;
  orphanUrls: string[];
  brokenInternalLinks: Array<{
    fromUrl: string;
    toUrl: string;
    statusCode: number;
  }>;
}

/**
 * Computes BFS link graph depth from the project root URL, inlink/outlink counts,
 * orphan pages (pages discovered via sitemap that have 0 internal inlinks and are not root),
 * and broken internal links (pointing to crawled pages with status >= 400 or status 0).
 */
export function computeLinkGraph(
  startUrl: string,
  pages: CrawledPageNode[],
): LinkGraphSummary {
  const normalizedStart = normalizeCrawlUrl(startUrl);
  const pageMap = new Map<string, CrawledPageNode>();

  for (const page of pages) {
    const norm = normalizeCrawlUrl(page.url);
    pageMap.set(norm, {
      ...page,
      url: norm,
      internalOutlinks: Array.from(
        new Set(page.internalOutlinks.map((u) => normalizeCrawlUrl(u))),
      ),
    });
  }

  const inlinksMap = new Map<string, Set<string>>();
  for (const url of pageMap.keys()) {
    inlinksMap.set(url, new Set<string>());
  }

  const brokenInternalLinks: Array<{
    fromUrl: string;
    toUrl: string;
    statusCode: number;
  }> = [];

  for (const [fromUrl, page] of pageMap.entries()) {
    for (const targetUrl of page.internalOutlinks) {
      if (targetUrl === fromUrl) continue; // self-link doesn't count as external inlink for orphan detection
      const targetSet = inlinksMap.get(targetUrl);
      if (targetSet) {
        targetSet.add(fromUrl);
      }
      const targetPage = pageMap.get(targetUrl);
      if (targetPage && (targetPage.statusCode >= 400 || targetPage.statusCode === 0)) {
        brokenInternalLinks.push({
          fromUrl,
          toUrl: targetUrl,
          statusCode: targetPage.statusCode,
        });
      }
    }
  }

  // BFS from normalizedStart to compute click depth
  const depthMap = new Map<string, number>();
  const queue: string[] = [];

  if (pageMap.has(normalizedStart)) {
    depthMap.set(normalizedStart, 0);
    queue.push(normalizedStart);
  } else {
    // Fallback to first page in crawl if exact normalizedStart redirected
    const firstUrl = pages[0] ? normalizeCrawlUrl(pages[0].url) : null;
    if (firstUrl && pageMap.has(firstUrl)) {
      depthMap.set(firstUrl, 0);
      queue.push(firstUrl);
    }
  }

  let head = 0;
  let maxDepth = 0;
  while (head < queue.length) {
    const currentUrl = queue[head++]!;
    const currentDepth = depthMap.get(currentUrl) ?? 0;
    if (currentDepth > maxDepth) {
      maxDepth = currentDepth;
    }

    const node = pageMap.get(currentUrl);
    if (!node) continue;

    for (const nextUrl of node.internalOutlinks) {
      if (!pageMap.has(nextUrl)) continue;
      if (!depthMap.has(nextUrl)) {
        depthMap.set(nextUrl, currentDepth + 1);
        queue.push(nextUrl);
      }
    }
  }

  const nodeMetrics = new Map<string, ComputedNodeMetrics>();
  const orphanUrls: string[] = [];

  for (const [url, page] of pageMap.entries()) {
    const inlinksCount = inlinksMap.get(url)?.size ?? 0;
    const depth = depthMap.get(url) ?? null;
    const isStart = url === normalizedStart || depth === 0;
    const isOrphan = !isStart && inlinksCount === 0;

    if (isOrphan && page.statusCode >= 200 && page.statusCode < 400) {
      orphanUrls.push(url);
    }

    const brokenOut = page.internalOutlinks.filter((target) => {
      const targetNode = pageMap.get(target);
      return targetNode ? targetNode.statusCode >= 400 || targetNode.statusCode === 0 : false;
    });

    nodeMetrics.set(url, {
      url,
      depth,
      inlinksCount,
      outlinksCount: page.internalOutlinks.length + page.externalOutlinks.length,
      isOrphan,
      brokenInternalOutlinks: brokenOut,
    });
  }

  return {
    nodeMetrics,
    maxDepth,
    orphanUrls,
    brokenInternalLinks,
  };
}
