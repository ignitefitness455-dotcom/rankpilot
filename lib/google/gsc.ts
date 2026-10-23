import { and, desc, eq, gte } from "drizzle-orm";
import { pages, searchPerformance } from "@/lib/db/schema";
import { withUserDb } from "@/lib/db/rls";
import { assertProjectAccess } from "@/lib/security/authz";
import { resolveGoogleAccessToken } from "./oauth";

export interface GscSyncResult {
  projectId: string;
  mode: "google_oauth" | "demo_seed";
  rowsUpserted: number;
  startDate: string;
  endDate: string;
  syncedAt: string;
}

export interface GscQueryRow {
  date: string;
  page: string;
  query: string;
  country: string;
  device: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function formatDateOffset(daysAgo: number, ref: Date = new Date()): string {
  const d = new Date(ref.getTime() - daysAgo * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Generates deterministic 56-day Search Console sample rows anchored to the project's actual URL/pages
 * when a live Google OAuth token is not connected, so solo site owners can test Quick Wins,
 * CTR Gaps, Content Decay, and Cannibalization immediately in local dev (`mode: "demo_seed"`).
 */
function buildDeterministicSampleGscRows(params: {
  baseUrl: string;
  host: string;
  crawledUrls: string[];
  days: number;
}): GscQueryRow[] {
  const cleanBase = params.baseUrl.replace(/\/$/, "");
  const pageList =
    params.crawledUrls.length >= 4
      ? params.crawledUrls.slice(0, 6)
      : [
          `${cleanBase}/`,
          `${cleanBase}/pricing`,
          `${cleanBase}/features/technical-seo-audit`,
          `${cleanBase}/blog/core-web-vitals-guide`,
          `${cleanBase}/blog/structured-data-json-ld`,
          `${cleanBase}/guides/internal-linking-strategy`,
        ];

  const brandToken = params.host.split(".")[0] || "rankpilot";
  const scenarios: Array<{
    query: string;
    pageIdx: number;
    altPageIdx?: number;
    baseImpressions: number;
    basePosition: number;
    ctrMultiplier: number;
    decaying?: boolean;
    winning?: boolean;
  }> = [
    // Quick win #1: position ~6.4, high impressions, below-curve CTR
    {
      query: "automated technical seo audit tool",
      pageIdx: 2 % pageList.length,
      baseImpressions: 420,
      basePosition: 6.4,
      ctrMultiplier: 0.48,
      winning: true,
    },
    // Quick win #2: position ~9.2, high impressions, below-curve CTR
    {
      query: "core web vitals lcp optimization checklist",
      pageIdx: 3 % pageList.length,
      baseImpressions: 380,
      basePosition: 9.2,
      ctrMultiplier: 0.45,
    },
    // Quick win #3: position ~12.5, high impressions
    {
      query: "json ld schema generator for articles",
      pageIdx: 4 % pageList.length,
      baseImpressions: 310,
      basePosition: 12.5,
      ctrMultiplier: 0.55,
    },
    // CTR gap at top position (#2.3 with low 3.1% CTR vs ~15% expected)
    {
      query: `${brandToken} pricing plans`,
      pageIdx: 1 % pageList.length,
      baseImpressions: 290,
      basePosition: 2.3,
      ctrMultiplier: 0.22,
    },
    // Content decay scenario: clicks drop >40% in recent 28 days vs prior 28 days
    {
      query: "internal linking best practices 2025",
      pageIdx: 5 % pageList.length,
      baseImpressions: 260,
      basePosition: 5.1,
      ctrMultiplier: 0.85,
      decaying: true,
    },
    // Cannibalization scenario: two URLs splitting impressions & alternating rank for same query
    {
      query: "ai seo audit software",
      pageIdx: 0,
      altPageIdx: 2 % pageList.length === 0 ? 1 % pageList.length : 2 % pageList.length,
      baseImpressions: 240,
      basePosition: 7.8,
      ctrMultiplier: 0.75,
    },
    // Strong brand winner
    {
      query: `${brandToken} seo agent`,
      pageIdx: 0,
      baseImpressions: 190,
      basePosition: 1.4,
      ctrMultiplier: 1.05,
      winning: true,
    },
  ];

  const expectedCtrForPos = (pos: number): number => {
    if (pos <= 1.5) return 0.28;
    if (pos <= 2.5) return 0.15;
    if (pos <= 3.5) return 0.1;
    if (pos <= 5.5) return 0.065;
    if (pos <= 8.5) return 0.042;
    if (pos <= 12.5) return 0.024;
    if (pos <= 20) return 0.014;
    return 0.006;
  };

  const rows: GscQueryRow[] = [];
  const totalDays = Math.max(28, Math.min(90, params.days));

  for (let dayOffset = totalDays; dayOffset >= 1; dayOffset--) {
    const dateStr = formatDateOffset(dayOffset);
    const isRecentHalf = dayOffset <= Math.floor(totalDays / 2);
    const wave = 1 + 0.08 * Math.sin(dayOffset * 0.45);

    for (const sc of scenarios) {
      let trendMult = 1.0;
      let posShift = 0;
      if (sc.decaying) {
        trendMult = isRecentHalf ? 0.52 : 1.15;
        posShift = isRecentHalf ? 3.4 : 0;
      } else if (sc.winning) {
        trendMult = isRecentHalf ? 1.28 : 0.88;
        posShift = isRecentHalf ? -0.9 : 0.4;
      }

      const impressions = Math.max(
        10,
        Math.round((sc.baseImpressions / 28) * wave * trendMult),
      );
      const position = Number(Math.max(1.0, sc.basePosition + posShift).toFixed(2));
      const rawCtr = expectedCtrForPos(position) * sc.ctrMultiplier;
      const clicks = Math.max(0, Math.round(impressions * rawCtr));
      const ctr = impressions > 0 ? Number((clicks / impressions).toFixed(4)) : 0;

      const primaryPage = pageList[sc.pageIdx] ?? `${cleanBase}/`;
      rows.push({
        date: dateStr,
        page: primaryPage,
        query: sc.query,
        country: "USA",
        device: "DESKTOP",
        clicks,
        impressions,
        ctr,
        position,
      });

      if (sc.altPageIdx !== undefined) {
        const altPage = pageList[sc.altPageIdx] ?? `${cleanBase}/features`;
        const altImpr = Math.max(8, Math.round(impressions * 0.82));
        const altPos = Number((position + (dayOffset % 2 === 0 ? -0.6 : 0.8)).toFixed(2));
        const altClicks = Math.max(0, Math.round(altImpr * expectedCtrForPos(altPos) * 0.7));
        rows.push({
          date: dateStr,
          page: altPage,
          query: sc.query,
          country: "USA",
          device: "DESKTOP",
          clicks: altClicks,
          impressions: altImpr,
          ctr: altImpr > 0 ? Number((altClicks / altImpr).toFixed(4)) : 0,
          position: altPos,
        });
      }
    }
  }

  return rows;
}

/**
 * Syncs Google Search Console Search Analytics rows into `search_performance`.
 * Uses live Google OAuth (`webmasters.readonly`) when connected; otherwise seeds realistic
 * sample rows anchored to the project's crawled pages (`mode: "demo_seed"`).
 */
export async function syncProjectSearchConsole(params: {
  userId: string;
  projectId: string;
  days?: number;
}): Promise<GscSyncResult> {
  const days = Math.max(14, Math.min(90, params.days ?? 56));
  const startDate = formatDateOffset(days);
  const endDate = formatDateOffset(1);

  const projectInfo = await withUserDb(params.userId, async (tx) => {
    const { project } = await assertProjectAccess(tx, params.userId, params.projectId, "editor");
    const crawledPages = await tx
      .select({ url: pages.url })
      .from(pages)
      .where(and(eq(pages.projectId, params.projectId), eq(pages.statusCode, 200)))
      .orderBy(desc(pages.inlinks))
      .limit(12);
    return {
      project,
      crawledUrls: crawledPages.map((p) => p.url),
    };
  });

  const oauth = await resolveGoogleAccessToken(params.userId, params.projectId);
  let rowsToUpsert: GscQueryRow[] = [];
  let mode: "google_oauth" | "demo_seed" = "demo_seed";

  if (oauth?.accessToken) {
    const property = oauth.gscProperty || projectInfo.project.url;
    const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${oauth.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ["date", "page", "query", "country", "device"],
        rowLimit: 2500,
      }),
    });

    if (res.ok) {
      mode = "google_oauth";
      const payload = (await res.json()) as {
        rows?: Array<{
          keys?: string[];
          clicks?: number;
          impressions?: number;
          ctr?: number;
          position?: number;
        }>;
      };
      for (const r of payload.rows ?? []) {
        const [date, page, query, country, device] = r.keys ?? [];
        if (!date || !page || !query) continue;
        rowsToUpsert.push({
          date,
          page,
          query,
          country: country ?? "",
          device: device ?? "",
          clicks: Math.round(r.clicks ?? 0),
          impressions: Math.round(r.impressions ?? 0),
          ctr: Number((r.ctr ?? 0).toFixed(4)),
          position: Number((r.position ?? 0).toFixed(2)),
        });
      }
    }
  }

  if (rowsToUpsert.length === 0) {
    mode = "demo_seed";
    rowsToUpsert = buildDeterministicSampleGscRows({
      baseUrl: projectInfo.project.url,
      host: projectInfo.project.host,
      crawledUrls: projectInfo.crawledUrls,
      days,
    });
  }

  await withUserDb(params.userId, async (tx) => {
    for (const row of rowsToUpsert) {
      await tx
        .insert(searchPerformance)
        .values({
          projectId: params.projectId,
          date: row.date,
          page: row.page,
          query: row.query,
          country: row.country,
          device: row.device,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
        })
        .onConflictDoUpdate({
          target: [
            searchPerformance.projectId,
            searchPerformance.date,
            searchPerformance.page,
            searchPerformance.query,
            searchPerformance.country,
            searchPerformance.device,
          ],
          set: {
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
          },
        });
    }
  });

  return {
    projectId: params.projectId,
    mode,
    rowsUpserted: rowsToUpsert.length,
    startDate,
    endDate,
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Queries stored `search_performance` rows for the agent tool `gsc_query` and UI charts.
 */
export async function queryStoredGscPerformance(params: {
  userId: string;
  projectId: string;
  days?: number;
  queryFilter?: string;
  pageFilter?: string;
  limit?: number;
}) {
  const days = Math.max(7, Math.min(90, params.days ?? 28));
  const startDate = formatDateOffset(days);

  return withUserDb(params.userId, async (tx) => {
    await assertProjectAccess(tx, params.userId, params.projectId, "viewer");
    const rows = await tx
      .select()
      .from(searchPerformance)
      .where(
        and(
          eq(searchPerformance.projectId, params.projectId),
          gte(searchPerformance.date, startDate),
        ),
      );

    const byKey = new Map<
      string,
      {
        query: string;
        page: string;
        clicks: number;
        impressions: number;
        weightedPosSum: number;
      }
    >();

    for (const r of rows) {
      if (
        params.queryFilter &&
        !r.query.toLowerCase().includes(params.queryFilter.toLowerCase())
      ) {
        continue;
      }
      if (params.pageFilter && !r.page.toLowerCase().includes(params.pageFilter.toLowerCase())) {
        continue;
      }
      const k = `${r.query}|||${r.page}`;
      const existing = byKey.get(k);
      if (existing) {
        existing.clicks += r.clicks;
        existing.impressions += r.impressions;
        existing.weightedPosSum += r.position * r.impressions;
      } else {
        byKey.set(k, {
          query: r.query,
          page: r.page,
          clicks: r.clicks,
          impressions: r.impressions,
          weightedPosSum: r.position * r.impressions,
        });
      }
    }

    const aggregated = [...byKey.values()]
      .map((item) => ({
        query: item.query,
        page: item.page,
        clicks: item.clicks,
        impressions: item.impressions,
        ctr: item.impressions > 0 ? Number((item.clicks / item.impressions).toFixed(4)) : 0,
        position:
          item.impressions > 0
            ? Number((item.weightedPosSum / item.impressions).toFixed(2))
            : 0,
      }))
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, params.limit ?? 25);

    return {
      startDate,
      days,
      totalRows: rows.length,
      items: aggregated,
    };
  });
}

/**
 * Inspects a URL via Google Search Console URL Inspection API when OAuth is connected,
 * or falls back to the latest crawled `pages` snapshot (transparently labeled).
 */
export async function inspectUrlIndexStatus(params: {
  userId: string;
  projectId: string;
  url: string;
}) {
  const oauth = await resolveGoogleAccessToken(params.userId, params.projectId);
  const projectRow = await withUserDb(params.userId, async (tx) => {
    const { project } = await assertProjectAccess(tx, params.userId, params.projectId, "viewer");
    const [crawledPage] = await tx
      .select()
      .from(pages)
      .where(and(eq(pages.projectId, params.projectId), eq(pages.url, params.url)))
      .orderBy(desc(pages.createdAt))
      .limit(1);
    return { project, crawledPage: crawledPage ?? null };
  });

  if (oauth?.accessToken) {
    try {
      const siteUrl = oauth.gscProperty || projectRow.project.url;
      const res = await fetch(
        "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${oauth.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            inspectionUrl: params.url,
            siteUrl,
          }),
        },
      );
      if (res.ok) {
        const json = (await res.json()) as Record<string, unknown>;
        return {
          url: params.url,
          source: "gsc_url_inspection_api" as const,
          isEstimate: false,
          result: json,
          checkedAt: new Date().toISOString(),
        };
      }
    } catch {
      // Fall through to crawler snapshot
    }
  }

  const p = projectRow.crawledPage;
  const noindex =
    Boolean(p?.robotsMeta?.toLowerCase().includes("noindex")) ||
    Boolean(p?.xRobots?.toLowerCase().includes("noindex"));

  return {
    url: params.url,
    source: "crawler_snapshot" as const,
    isEstimate: true,
    confidence: p ? 0.85 : 0.3,
    result: p
      ? {
          statusCode: p.statusCode,
          indexableByRobotsTag: !noindex && p.statusCode === 200,
          canonical: p.canonical,
          robotsMeta: p.robotsMeta,
          lastCrawledAt: p.createdAt.toISOString(),
        }
      : {
          message:
            "URL not found in latest crawl and Google OAuth is not connected. Run a crawl or connect Search Console.",
        },
    checkedAt: new Date().toISOString(),
  };
}
