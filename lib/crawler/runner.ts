import { EventEmitter } from "node:events";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { runDeterministicAuditEngine } from "@/lib/audit/engine";
import type { CrawledPageWithChain, CwvMetricSnapshot } from "@/lib/audit/rules";
import { safeFetchUrl } from "@/lib/crawler/fetcher";
import { computeLinkGraph } from "@/lib/crawler/linkgraph";
import { normalizeCrawlUrl, parseHtmlPage } from "@/lib/crawler/parse";
import { renderPageWithPlaywright } from "@/lib/crawler/render";
import {
  getCrawlDelayForAgent,
  isAllowedByRobots,
  parseRobotsTxt,
} from "@/lib/crawler/robots";
import { fetchAndParseSitemaps } from "@/lib/crawler/sitemap";
import { withUserDb } from "@/lib/db/rls";
import {
  alerts,
  crawls,
  cwvResults,
  ignoredRules,
  issueInstances,
  issues,
  links,
  pages,
  projects,
  tasks,
  type IssueStatus,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { assertProjectRole } from "@/lib/security/authz";
import { getEnv } from "@/lib/security/env";
import type { SsrfValidationOptions } from "@/lib/security/ssrf";

export interface CrawlProgressEvent {
  crawlId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  pagesFound: number;
  pagesCrawled: number;
  progress: number;
  healthScore?: number | null;
  currentUrl?: string;
  error?: string | null;
}

const crawlEmitter = new EventEmitter();
crawlEmitter.setMaxListeners(100);

const cancelledCrawlIds = new Set<string>();
const activeInProcessCrawls = new Set<string>();

export function subscribeCrawlProgress(
  crawlId: string,
  listener: (event: CrawlProgressEvent) => void,
): () => void {
  const channel = `crawl:${crawlId}`;
  crawlEmitter.on(channel, listener);
  return () => {
    crawlEmitter.off(channel, listener);
  };
}

function emitCrawlProgress(event: CrawlProgressEvent): void {
  crawlEmitter.emit(`crawl:${event.crawlId}`, event);
}

export interface QueueCrawlOptions {
  userId: string;
  projectId: string;
  trigger?: "manual" | "schedule" | "onboarding" | "agent";
  maxPages?: number;
  maxDepth?: number;
  render?: boolean;
  executeInBackground?: boolean;
  ssrfOptions?: SsrfValidationOptions;
}

/**
 * Enqueues a crawl for a project, enforcing the 50-page cap on unverified sites
 * and preventing duplicate concurrent crawls for the same project.
 */
export async function queueProjectCrawl(options: QueueCrawlOptions) {
  const env = getEnv();
  const trigger = options.trigger ?? "manual";

  const crawlRow = await withUserDb(options.userId, async (tx) => {
    await assertProjectRole(tx, options.userId, options.projectId, "editor");

    const [project] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, options.projectId))
      .limit(1);

    if (!project) {
      throw new Error("Project not found");
    }

    // Check if there is already a queued or running crawl
    const [existingActive] = await tx
      .select()
      .from(crawls)
      .where(
        and(
          eq(crawls.projectId, options.projectId),
          inArray(crawls.status, ["queued", "running"]),
        ),
      )
      .orderBy(desc(crawls.createdAt))
      .limit(1);

    if (existingActive) {
      return existingActive;
    }

    const isVerified = Boolean(project.verifiedAt);
    const requestedMaxPages =
      options.maxPages ?? project.settings?.crawl?.maxPages ?? env.CRAWLER_MAX_PAGES_DEFAULT;
    const maxPagesCap = isVerified
      ? env.CRAWLER_MAX_PAGES_HARD
      : env.CRAWLER_MAX_PAGES_UNVERIFIED;
    const effectiveMaxPages = Math.max(1, Math.min(requestedMaxPages, maxPagesCap));

    const effectiveMaxDepth = Math.max(
      1,
      Math.min(
        options.maxDepth ?? project.settings?.crawl?.maxDepth ?? env.CRAWLER_MAX_DEPTH_DEFAULT,
        20,
      ),
    );
    const effectiveRender =
      options.render ?? project.settings?.crawl?.render ?? env.CRAWLER_ENABLE_RENDER;
    const effectiveRps = Math.max(
      0.2,
      Math.min(project.settings?.crawl?.rps ?? env.CRAWLER_RPS, 10),
    );

    const [inserted] = await tx
      .insert(crawls)
      .values({
        projectId: project.id,
        status: "queued",
        trigger,
        config: {
          maxPages: effectiveMaxPages,
          maxDepth: effectiveMaxDepth,
          render: effectiveRender,
          rps: effectiveRps,
          verified: isVerified,
        },
        pagesFound: 1,
        pagesCrawled: 0,
        progress: 0,
      })
      .returning();

    return inserted!;
  });

  if (options.executeInBackground !== false) {
    // Launch asynchronously without blocking caller
    setImmediate(() => {
      executeCrawlById(crawlRow.id, options.userId, options.ssrfOptions).catch((err) => {
        logger.error({ err, crawlId: crawlRow.id }, "Background crawl execution failed");
      });
    });
  }

  return crawlRow;
}

export async function cancelCrawlJob(params: {
  userId: string;
  crawlId: string;
}) {
  cancelledCrawlIds.add(params.crawlId);

  return withUserDb(params.userId, async (tx) => {
    const [crawl] = await tx
      .select()
      .from(crawls)
      .where(eq(crawls.id, params.crawlId))
      .limit(1);

    if (!crawl) {
      throw new Error("Crawl not found");
    }

    await assertProjectRole(tx, params.userId, crawl.projectId, "editor");

    if (crawl.status === "completed" || crawl.status === "failed") {
      return crawl;
    }

    const now = new Date();
    const [updated] = await tx
      .update(crawls)
      .set({
        status: "cancelled",
        finishedAt: now,
        updatedAt: now,
      })
      .where(eq(crawls.id, params.crawlId))
      .returning();

    emitCrawlProgress({
      crawlId: params.crawlId,
      status: "cancelled",
      pagesFound: updated!.pagesFound,
      pagesCrawled: updated!.pagesCrawled,
      progress: updated!.progress,
    });

    return updated!;
  });
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSameHost(candidateUrl: string, projectHost: string): boolean {
  try {
    const u = new URL(candidateUrl);
    return u.host.toLowerCase() === projectHost.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Executes a queued crawl end-to-end:
 * 1. Fetches robots.txt and XML sitemaps
 * 2. Runs BFS crawl with rate limiting, robots.txt enforcement, and SSRF validation
 * 3. Computes internal link graph (BFS depth, inlinks, outlinks, orphans, broken links)
 * 4. Runs deterministic audit engine (40 rules) + calculates 0-100 health score
 * 5. Updates issue lifecycle (open / fixed / regressed / ignored) and Action Center tasks
 */
export async function executeCrawlById(
  crawlId: string,
  userId: string,
  ssrfOptions?: SsrfValidationOptions,
) {
  if (activeInProcessCrawls.has(crawlId)) {
    return;
  }
  activeInProcessCrawls.add(crawlId);

  const env = getEnv();

  try {
    const contextData = await withUserDb(userId, async (tx) => {
      const [crawl] = await tx
        .select()
        .from(crawls)
        .where(eq(crawls.id, crawlId))
        .limit(1);

      if (!crawl) throw new Error(`Crawl ${crawlId} not found`);
      if (crawl.status === "cancelled" || crawl.status === "completed") {
        return null;
      }

      const [project] = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, crawl.projectId))
        .limit(1);

      if (!project) throw new Error(`Project ${crawl.projectId} not found`);

      const now = new Date();
      await tx
        .update(crawls)
        .set({
          status: "running",
          startedAt: now,
          updatedAt: now,
        })
        .where(eq(crawls.id, crawlId));

      return { crawl, project };
    });

    if (!contextData) return;

    const { crawl, project } = contextData;
    const cfg = (crawl.config ?? {}) as {
      maxPages?: number;
      maxDepth?: number;
      render?: boolean;
      rps?: number;
    };

    const maxPages = cfg.maxPages ?? 50;
    const maxDepth = cfg.maxDepth ?? 5;
    const useRender = Boolean(cfg.render);
    const rps = cfg.rps ?? env.CRAWLER_RPS;
    const userAgent = env.CRAWLER_USER_AGENT;

    const rootUrlObj = new URL(project.url);
    const origin = rootUrlObj.origin;
    const projectHost = rootUrlObj.host;

    emitCrawlProgress({
      crawlId,
      status: "running",
      pagesFound: 1,
      pagesCrawled: 0,
      progress: 2,
      currentUrl: `${origin}/robots.txt`,
    });

    // Step 1: Fetch & parse robots.txt
    const robotsUrl = `${origin}/robots.txt`;
    let robots = parseRobotsTxt("", 404);
    try {
      const robotsRes = await safeFetchUrl(robotsUrl, {
        userAgent,
        timeoutMs: 10_000,
        ssrfOptions,
      });
      robots = parseRobotsTxt(robotsRes.bodyText, robotsRes.statusCode);
    } catch {
      robots = parseRobotsTxt("", 0);
    }

    const robotsDelaySec = getCrawlDelayForAgent(robots, "RankPilotBot");
    const minDelayMs =
      robotsDelaySec !== null
        ? Math.max(robotsDelaySec * 1000, Math.round(1000 / rps))
        : Math.round(1000 / rps);

    // Step 2: Fetch & parse XML sitemaps
    const sitemapResult = await fetchAndParseSitemaps(origin, robots.sitemaps, {
      userAgent,
      timeoutMs: 10_000,
      ssrfOptions,
    });

    // Step 3: Seed crawl frontier (root URL first, then sitemap URLs)
    const startNorm = normalizeCrawlUrl(project.url);
    const queue: Array<{ url: string; depth: number }> = [{ url: startNorm, depth: 0 }];
    const queuedSet = new Set<string>([startNorm]);

    for (const smUrl of sitemapResult.allPageUrls) {
      if (queuedSet.size >= maxPages * 2) break;
      if (!isSameHost(smUrl, projectHost)) continue;
      const norm = normalizeCrawlUrl(smUrl);
      if (!queuedSet.has(norm)) {
        queuedSet.add(norm);
        queue.push({ url: norm, depth: 1 });
      }
    }

    const crawledPages: CrawledPageWithChain[] = [];
    let head = 0;

    while (head < queue.length && crawledPages.length < maxPages) {
      if (cancelledCrawlIds.has(crawlId)) {
        return;
      }

      const current = queue[head++]!;
      if (current.depth > maxDepth) continue;

      let urlObj: URL;
      try {
        urlObj = new URL(current.url);
      } catch {
        continue;
      }

      const pathWithQuery = `${urlObj.pathname}${urlObj.search}`;
      if (!isAllowedByRobots(robots, pathWithQuery, "RankPilotBot")) {
        continue;
      }

      if (crawledPages.length > 0 && minDelayMs > 0) {
        await sleep(Math.min(minDelayMs, 2000));
      }

      try {
        const res = await safeFetchUrl(current.url, {
          userAgent,
          timeoutMs: 15_000,
          ssrfOptions,
        });

        let htmlBody = res.bodyText;
        let finalUrl = res.finalUrl;
        let statusCode = res.statusCode;
        let rendered = false;

        if (
          useRender &&
          statusCode >= 200 &&
          statusCode < 300 &&
          res.contentType.toLowerCase().includes("html")
        ) {
          try {
            const renderRes = await renderPageWithPlaywright(current.url, {
              userAgent,
              timeoutMs: 18_000,
              ssrfOptions,
            });
            htmlBody = renderRes.html;
            finalUrl = renderRes.finalUrl;
            statusCode = renderRes.statusCode;
            rendered = renderRes.usedHeadless;
          } catch {
            // Graceful fallback to static HTML when headless Chromium is unavailable
            rendered = false;
          }
        }

        const parsed = parseHtmlPage({
          url: current.url,
          finalUrl,
          statusCode,
          contentType: res.contentType,
          headers: res.headers,
          html: htmlBody,
          bytes: res.bytes,
          ttfbMs: res.ttfbMs,
        });

        crawledPages.push({
          ...parsed,
          redirectChain: res.redirectChain,
          rendered,
        });

        // Enqueue newly discovered internal links
        if (current.depth < maxDepth) {
          for (const link of parsed.links) {
            if (!link.isInternal) continue;
            if (link.rel.toLowerCase().includes("nofollow")) continue;
            if (!isSameHost(link.toUrl, projectHost)) continue;
            const normLink = normalizeCrawlUrl(link.toUrl);
            if (!queuedSet.has(normLink) && queuedSet.size < maxPages * 3) {
              queuedSet.add(normLink);
              queue.push({ url: normLink, depth: current.depth + 1 });
            }
          }
        }
      } catch (fetchErr) {
        logger.warn(
          { url: current.url, err: fetchErr instanceof Error ? fetchErr.message : String(fetchErr) },
          "Failed to fetch page during crawl",
        );
      }

      const targetCount = Math.min(maxPages, queue.length);
      const progressPct = Math.min(
        90,
        Math.round((crawledPages.length / Math.max(1, targetCount)) * 85) + 5,
      );

      await withUserDb(userId, async (tx) => {
        await tx
          .update(crawls)
          .set({
            pagesFound: queue.length,
            pagesCrawled: crawledPages.length,
            progress: progressPct,
            updatedAt: new Date(),
          })
          .where(eq(crawls.id, crawlId));
      });

      emitCrawlProgress({
        crawlId,
        status: "running",
        pagesFound: queue.length,
        pagesCrawled: crawledPages.length,
        progress: progressPct,
        currentUrl: current.url,
      });
    }

    if (cancelledCrawlIds.has(crawlId)) {
      return;
    }

    // Step 4: Compute link graph
    const linkGraph = computeLinkGraph(
      startNorm,
      crawledPages.map((p) => ({
        url: p.url,
        statusCode: p.statusCode,
        internalOutlinks: p.links.filter((l) => l.isInternal).map((l) => l.toUrl),
        externalOutlinks: p.links.filter((l) => !l.isInternal).map((l) => l.toUrl),
      })),
    );

    // Step 5: Persist pages, links, audit findings, issue lifecycle & tasks inside withUserDb
    const finalResult = await withUserDb(userId, async (tx) => {
      // Load recent CWV snapshots for this project to feed into performance audit rules
      const rawCwvRows = await tx
        .select()
        .from(cwvResults)
        .where(eq(cwvResults.projectId, project.id))
        .orderBy(desc(cwvResults.fetchedAt))
        .limit(20);

      const seenCwvKeys = new Set<string>();
      const cwvSnapshots: CwvMetricSnapshot[] = [];
      for (const row of rawCwvRows) {
        const key = `${row.url}:${row.strategy}:${row.source}`;
        if (seenCwvKeys.has(key)) continue;
        seenCwvKeys.add(key);
        cwvSnapshots.push({
          url: row.url,
          strategy: row.strategy,
          source: row.source,
          lcpMs: row.lcpMs,
          inpMs: row.inpMs,
          cls: row.cls,
          fcpMs: row.fcpMs,
          ttfbMs: row.ttfbMs,
          perfScore: row.perfScore,
        });
      }

      // Insert crawled pages
      const pageIdByNormUrl = new Map<string, string>();
      for (const p of crawledPages) {
        const normUrl = normalizeCrawlUrl(p.url);
        const metrics = linkGraph.nodeMetrics.get(normUrl);
        const [insertedPage] = await tx
          .insert(pages)
          .values({
            projectId: project.id,
            crawlId,
            url: normUrl,
            urlHash: p.urlHash,
            finalUrl: p.finalUrl,
            statusCode: p.statusCode,
            redirectChain: p.redirectChain,
            contentType: p.contentType,
            title: p.title,
            metaDescription: p.metaDescription,
            canonical: p.canonical,
            robotsMeta: p.robotsMeta,
            xRobots: p.xRobots,
            hreflang: p.hreflang,
            h1: p.h1,
            headings: p.headings,
            wordCount: p.wordCount,
            textHash: p.textHash,
            depth: metrics?.depth ?? null,
            inlinks: metrics?.inlinksCount ?? 0,
            outlinks: metrics?.outlinksCount ?? 0,
            schemaTypes: p.schemaTypes,
            schemaRaw: p.schemaRaw,
            hasViewport: p.hasViewport,
            lang: p.lang,
            bytes: p.bytes,
            ttfbMs: p.ttfbMs,
            rendered: p.rendered,
            injectionFlag: p.injectionFlag,
            summary: p.summary,
          })
          .onConflictDoUpdate({
            target: [pages.crawlId, pages.urlHash],
            set: {
              statusCode: p.statusCode,
              inlinks: metrics?.inlinksCount ?? 0,
              outlinks: metrics?.outlinksCount ?? 0,
              depth: metrics?.depth ?? null,
            },
          })
          .returning({ id: pages.id });

        if (insertedPage) {
          pageIdByNormUrl.set(normUrl, insertedPage.id);
        }
      }

      // Insert links (capped to 2500 rows per crawl to keep inserts fast)
      const linkRowsToInsert: Array<typeof links.$inferInsert> = [];
      const statusByNormUrl = new Map<string, number>();
      for (const p of crawledPages) {
        statusByNormUrl.set(normalizeCrawlUrl(p.url), p.statusCode);
      }

      for (const p of crawledPages) {
        const fromNorm = normalizeCrawlUrl(p.url);
        const fromPageId = pageIdByNormUrl.get(fromNorm);
        if (!fromPageId) continue;

        for (const l of p.links.slice(0, 150)) {
          if (linkRowsToInsert.length >= 2500) break;
          const toNorm = l.isInternal ? normalizeCrawlUrl(l.toUrl) : l.toUrl;
          const toPageId = l.isInternal ? (pageIdByNormUrl.get(toNorm) ?? null) : null;
          const targetStatus = l.isInternal ? (statusByNormUrl.get(toNorm) ?? null) : null;

          linkRowsToInsert.push({
            projectId: project.id,
            crawlId,
            fromPageId,
            toUrl: toNorm,
            toPageId,
            anchor: l.anchor.slice(0, 250),
            rel: l.rel || null,
            isInternal: l.isInternal,
            statusCode: targetStatus,
          });
        }
      }

      if (linkRowsToInsert.length > 0) {
        await tx.insert(links).values(linkRowsToInsert);
      }

      // Auto-update project CMS & language from root page if detected
      const rootPage = crawledPages[0];
      if (rootPage && (rootPage.detectedCms || rootPage.lang)) {
        await tx
          .update(projects)
          .set({
            cms: project.cms ?? rootPage.detectedCms ?? null,
            language: project.language ?? rootPage.lang ?? null,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, project.id));
      }

      // Run deterministic audit engine
      const auditResult = runDeterministicAuditEngine({
        rootUrl: project.url,
        crawledAtIso: new Date().toISOString(),
        pages: crawledPages,
        robots,
        sitemaps: sitemapResult.sitemaps,
        linkGraph,
        cwvSnapshots,
      });

      // Reconcile issue lifecycle (open / fixed / regressed / ignored)
      const existingIssues = await tx
        .select()
        .from(issues)
        .where(eq(issues.projectId, project.id));
      const existingByRule = new Map(existingIssues.map((i) => [i.ruleId, i]));

      const ignoredRuleRows = await tx
        .select()
        .from(ignoredRules)
        .where(eq(ignoredRules.projectId, project.id));
      const ignoredRuleSet = new Set(
        ignoredRuleRows.map((r) => r.ruleId).filter((id): id is string => Boolean(id)),
      );

      const activeRuleIds = new Set<string>();
      let regressedCount = 0;

      for (const evalItem of auditResult.evaluated) {
        const finding = evalItem.finding;
        activeRuleIds.add(finding.id);

        const prev = existingByRule.get(finding.id);
        let nextStatus: IssueStatus = "open";
        if (ignoredRuleSet.has(finding.id) || prev?.status === "ignored") {
          nextStatus = "ignored";
        } else if (prev?.status === "fixed") {
          nextStatus = "regressed";
          regressedCount += 1;
        }

        const now = new Date();
        const [upsertedIssue] = await tx
          .insert(issues)
          .values({
            projectId: project.id,
            ruleId: finding.id,
            category: finding.category,
            severity: finding.severity,
            status: nextStatus,
            firstSeenCrawlId: prev?.firstSeenCrawlId ?? crawlId,
            lastSeenCrawlId: crawlId,
            fixedCrawlId: null,
            affectedCount: finding.affected_count,
            finding,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [issues.projectId, issues.ruleId],
            set: {
              category: finding.category,
              severity: finding.severity,
              status: nextStatus,
              lastSeenCrawlId: crawlId,
              fixedCrawlId: null,
              affectedCount: finding.affected_count,
              finding,
              updatedAt: now,
            },
          })
          .returning();

        if (!upsertedIssue) continue;

        // Create issue_instances rows for affected pages (or site-level instance)
        const instanceRows: Array<typeof issueInstances.$inferInsert> = [];
        if (evalItem.pageEvidenceMap.size > 0) {
          for (const [pageUrl, pageEv] of evalItem.pageEvidenceMap.entries()) {
            const pId = pageIdByNormUrl.get(normalizeCrawlUrl(pageUrl)) ?? null;
            instanceRows.push({
              projectId: project.id,
              issueId: upsertedIssue.id,
              crawlId,
              pageId: pId,
              evidence: pageEv,
            });
          }
        } else {
          instanceRows.push({
            projectId: project.id,
            issueId: upsertedIssue.id,
            crawlId,
            pageId: null,
            evidence: finding.evidence,
          });
        }

        if (instanceRows.length > 0) {
          await tx.insert(issueInstances).values(instanceRows.slice(0, 100));
        }

        // Auto-create Action Center task for open/regressed critical & high-impact warning findings
        if (
          nextStatus !== "ignored" &&
          (finding.severity === "critical" ||
            (finding.severity === "warning" && finding.impact >= 4))
        ) {
          const [existingTask] = await tx
            .select({ id: tasks.id })
            .from(tasks)
            .where(
              and(
                eq(tasks.projectId, project.id),
                eq(tasks.issueId, upsertedIssue.id),
              ),
            )
            .limit(1);

          if (!existingTask) {
            const priorityScore = Math.min(
              100,
              Math.max(
                10,
                Math.round(
                  (finding.impact * 20 * finding.confidence) /
                    Math.max(1, finding.effort * 0.5),
                ),
              ),
            );
            await tx.insert(tasks).values({
              projectId: project.id,
              issueId: upsertedIssue.id,
              source: "audit",
              title: finding.title,
              description: `${finding.why_it_matters} (${finding.affected_count} affected URL${finding.affected_count === 1 ? "" : "s"})`,
              impact: finding.impact,
              effort: finding.effort,
              confidence: finding.confidence,
              priority: priorityScore,
              status: "todo",
              position: priorityScore,
              fix: finding.fix,
            });
          }
        }
      }

      // Mark previously open/regressed issues that did NOT appear in this crawl as fixed
      for (const prev of existingIssues) {
        if (
          !activeRuleIds.has(prev.ruleId) &&
          (prev.status === "open" || prev.status === "regressed")
        ) {
          await tx
            .update(issues)
            .set({
              status: "fixed",
              fixedCrawlId: crawlId,
              affectedCount: 0,
              updatedAt: new Date(),
            })
            .where(eq(issues.id, prev.id));
        }
      }

      // Update crawl row to completed
      const finishedAt = new Date();
      const [completedCrawl] = await tx
        .update(crawls)
        .set({
          status: "completed",
          pagesFound: queue.length,
          pagesCrawled: crawledPages.length,
          progress: 100,
          healthScore: auditResult.score.overall,
          scoreBreakdown: auditResult.score.categories,
          finishedAt,
          updatedAt: finishedAt,
        })
        .where(eq(crawls.id, crawlId))
        .returning();

      // Emit alert notification
      await tx.insert(alerts).values({
        projectId: project.id,
        kind: regressedCount > 0 ? "audit_regression" : "crawl_completed",
        severity:
          regressedCount > 0
            ? "critical"
            : auditResult.score.countsBySeverity.critical > 0
              ? "warning"
              : "info",
        title:
          regressedCount > 0
            ? `Site Audit completed (Score ${auditResult.score.overall}/100) — ${regressedCount} issue(s) regressed`
            : `Site Audit completed: Health Score ${auditResult.score.overall}/100 across ${crawledPages.length} pages`,
        data: {
          crawlId,
          healthScore: auditResult.score.overall,
          pagesCrawled: crawledPages.length,
          countsBySeverity: auditResult.score.countsBySeverity,
        },
      });

      return completedCrawl!;
    });

    emitCrawlProgress({
      crawlId,
      status: "completed",
      pagesFound: finalResult.pagesFound,
      pagesCrawled: finalResult.pagesCrawled,
      progress: 100,
      healthScore: finalResult.healthScore,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, crawlId }, "Crawl failed with error");
    try {
      await withUserDb(userId, async (tx) => {
        const now = new Date();
        await tx
          .update(crawls)
          .set({
            status: "failed",
            error: errorMsg,
            finishedAt: now,
            updatedAt: now,
          })
          .where(eq(crawls.id, crawlId));
      });
    } catch {
      // ignore secondary DB error
    }
    emitCrawlProgress({
      crawlId,
      status: "failed",
      pagesFound: 0,
      pagesCrawled: 0,
      progress: 0,
      error: errorMsg,
    });
  } finally {
    activeInProcessCrawls.delete(crawlId);
    cancelledCrawlIds.delete(crawlId);
  }
}

// ============================================================================
// READ & QUERY SERVICES FOR CRAWLS, ISSUES, AND PAGES
// ============================================================================

export async function listProjectCrawls(userId: string, projectId: string) {
  return withUserDb(userId, async (tx) => {
    await assertProjectRole(tx, userId, projectId, "viewer");
    return tx
      .select()
      .from(crawls)
      .where(eq(crawls.projectId, projectId))
      .orderBy(desc(crawls.createdAt))
      .limit(25);
  });
}

export async function getCrawlDetails(userId: string, crawlId: string) {
  return withUserDb(userId, async (tx) => {
    const [crawl] = await tx
      .select()
      .from(crawls)
      .where(eq(crawls.id, crawlId))
      .limit(1);
    if (!crawl) return null;
    await assertProjectRole(tx, userId, crawl.projectId, "viewer");
    return crawl;
  });
}

export async function listProjectIssues(params: {
  userId: string;
  projectId: string;
  category?: string;
  severity?: string;
  status?: string;
}) {
  return withUserDb(params.userId, async (tx) => {
    await assertProjectRole(tx, params.userId, params.projectId, "viewer");

    const rows = await tx
      .select()
      .from(issues)
      .where(eq(issues.projectId, params.projectId))
      .orderBy(desc(issues.updatedAt));

    return rows.filter((r) => {
      if (params.category && params.category !== "all" && r.category !== params.category) {
        return false;
      }
      if (params.severity && params.severity !== "all" && r.severity !== params.severity) {
        return false;
      }
      if (params.status && params.status !== "all" && r.status !== params.status) {
        return false;
      }
      return true;
    });
  });
}

export async function getIssueDetails(userId: string, issueId: string) {
  return withUserDb(userId, async (tx) => {
    const [issue] = await tx
      .select()
      .from(issues)
      .where(eq(issues.id, issueId))
      .limit(1);

    if (!issue) return null;
    await assertProjectRole(tx, userId, issue.projectId, "viewer");

    const instances = await tx
      .select({
        id: issueInstances.id,
        crawlId: issueInstances.crawlId,
        pageId: issueInstances.pageId,
        evidence: issueInstances.evidence,
        createdAt: issueInstances.createdAt,
      })
      .from(issueInstances)
      .where(
        and(
          eq(issueInstances.issueId, issue.id),
          issue.lastSeenCrawlId
            ? eq(issueInstances.crawlId, issue.lastSeenCrawlId)
            : sql`true`,
        ),
      )
      .limit(100);

    return {
      issue,
      instances,
    };
  });
}

export async function updateIssueStatus(params: {
  userId: string;
  issueId: string;
  status: IssueStatus;
  ignoredReason?: string;
}) {
  return withUserDb(params.userId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(issues)
      .where(eq(issues.id, params.issueId))
      .limit(1);

    if (!existing) {
      throw new Error("Issue not found");
    }

    await assertProjectRole(tx, params.userId, existing.projectId, "editor");

    const now = new Date();
    const [updated] = await tx
      .update(issues)
      .set({
        status: params.status,
        ignoredReason:
          params.status === "ignored"
            ? (params.ignoredReason ?? "Ignored by user")
            : null,
        updatedAt: now,
      })
      .where(eq(issues.id, params.issueId))
      .returning();

    if (params.status === "ignored") {
      await tx.insert(ignoredRules).values({
        projectId: existing.projectId,
        ruleId: existing.ruleId,
        reason: params.ignoredReason ?? "Ignored in Site Audit",
        userId: params.userId,
      });
    } else {
      await tx
        .delete(ignoredRules)
        .where(
          and(
            eq(ignoredRules.projectId, existing.projectId),
            eq(ignoredRules.ruleId, existing.ruleId),
          ),
        );
    }

    return updated!;
  });
}

export async function compareProjectCrawls(params: {
  userId: string;
  projectId: string;
  crawlAId?: string;
  crawlBId?: string;
}) {
  return withUserDb(params.userId, async (tx) => {
    await assertProjectRole(tx, params.userId, params.projectId, "viewer");

    const projectCrawls = await tx
      .select()
      .from(crawls)
      .where(
        and(
          eq(crawls.projectId, params.projectId),
          eq(crawls.status, "completed"),
        ),
      )
      .orderBy(desc(crawls.createdAt))
      .limit(10);

    const crawlB = params.crawlBId
      ? projectCrawls.find((c) => c.id === params.crawlBId)
      : projectCrawls[0];
    const crawlA = params.crawlAId
      ? projectCrawls.find((c) => c.id === params.crawlAId)
      : projectCrawls[1];

    const allIssues = await tx
      .select()
      .from(issues)
      .where(eq(issues.projectId, params.projectId));

    const newIssues = allIssues.filter(
      (i) => crawlB && i.firstSeenCrawlId === crawlB.id && i.status === "open",
    );
    const fixedIssues = allIssues.filter(
      (i) => crawlB && i.fixedCrawlId === crawlB.id && i.status === "fixed",
    );
    const regressedIssues = allIssues.filter((i) => i.status === "regressed");

    return {
      previousCrawl: crawlA ?? null,
      currentCrawl: crawlB ?? null,
      scoreDelta:
        crawlB?.healthScore !== null &&
        crawlB?.healthScore !== undefined &&
        crawlA?.healthScore !== null &&
        crawlA?.healthScore !== undefined
          ? crawlB.healthScore - crawlA.healthScore
          : null,
      newIssues,
      fixedIssues,
      regressedIssues,
    };
  });
}

export async function listProjectPages(params: {
  userId: string;
  projectId: string;
  crawlId?: string;
  statusFilter?: string;
  search?: string;
}) {
  return withUserDb(params.userId, async (tx) => {
    await assertProjectRole(tx, params.userId, params.projectId, "viewer");

    let targetCrawlId = params.crawlId;
    if (!targetCrawlId) {
      const [latestCrawl] = await tx
        .select({ id: crawls.id })
        .from(crawls)
        .where(eq(crawls.projectId, params.projectId))
        .orderBy(desc(crawls.createdAt))
        .limit(1);
      targetCrawlId = latestCrawl?.id;
    }

    if (!targetCrawlId) {
      return { crawlId: null, pages: [] };
    }

    const rows = await tx
      .select()
      .from(pages)
      .where(
        and(
          eq(pages.projectId, params.projectId),
          eq(pages.crawlId, targetCrawlId),
        ),
      )
      .orderBy(pages.depth, pages.url)
      .limit(500);

    const searchLower = params.search?.trim().toLowerCase() ?? "";

    const filtered = rows.filter((p) => {
      if (params.statusFilter === "2xx" && ((p.statusCode ?? 0) < 200 || (p.statusCode ?? 0) >= 300)) {
        return false;
      }
      if (params.statusFilter === "3xx" && ((p.statusCode ?? 0) < 300 || (p.statusCode ?? 0) >= 400)) {
        return false;
      }
      if (params.statusFilter === "4xx" && ((p.statusCode ?? 0) < 400 || (p.statusCode ?? 0) >= 500)) {
        return false;
      }
      if (params.statusFilter === "5xx" && (p.statusCode ?? 0) < 500) {
        return false;
      }
      if (params.statusFilter === "orphan" && (p.inlinks > 0 || p.depth === 0)) {
        return false;
      }
      if (
        searchLower &&
        !p.url.toLowerCase().includes(searchLower) &&
        !(p.title ?? "").toLowerCase().includes(searchLower)
      ) {
        return false;
      }
      return true;
    });

    return {
      crawlId: targetCrawlId,
      pages: filtered,
    };
  });
}

export async function getPageDetails(userId: string, pageId: string) {
  return withUserDb(userId, async (tx) => {
    const [page] = await tx
      .select()
      .from(pages)
      .where(eq(pages.id, pageId))
      .limit(1);

    if (!page) return null;
    await assertProjectRole(tx, userId, page.projectId, "viewer");

    const outgoingLinks = await tx
      .select()
      .from(links)
      .where(eq(links.fromPageId, page.id))
      .limit(150);

    const incomingLinks = await tx
      .select({
        id: links.id,
        fromPageId: links.fromPageId,
        toUrl: links.toUrl,
        anchor: links.anchor,
        rel: links.rel,
        fromUrl: pages.url,
        fromTitle: pages.title,
      })
      .from(links)
      .innerJoin(pages, eq(links.fromPageId, pages.id))
      .where(eq(links.toPageId, page.id))
      .limit(150);

    const pageIssueRows = await tx
      .select({
        instanceId: issueInstances.id,
        evidence: issueInstances.evidence,
        issueId: issues.id,
        ruleId: issues.ruleId,
        category: issues.category,
        severity: issues.severity,
        status: issues.status,
        finding: issues.finding,
      })
      .from(issueInstances)
      .innerJoin(issues, eq(issueInstances.issueId, issues.id))
      .where(eq(issueInstances.pageId, page.id));

    return {
      page,
      outgoingLinks,
      incomingLinks,
      issues: pageIssueRows,
    };
  });
}
