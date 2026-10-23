import { and, desc, eq, gte } from "drizzle-orm";
import { alerts, searchPerformance } from "@/lib/db/schema";
import { withUserDb } from "@/lib/db/rls";
import { assertProjectAccess } from "@/lib/security/authz";
import { getGoogleConnectionStatus } from "@/lib/google/oauth";
import type { GscQueryRow } from "@/lib/google/gsc";

export interface PerformanceOverviewKpis {
  currentClicks: number;
  previousClicks: number;
  clicksDeltaPct: number;
  currentImpressions: number;
  previousImpressions: number;
  impressionsDeltaPct: number;
  currentCtr: number;
  previousCtr: number;
  currentPosition: number;
  previousPosition: number;
  dailySeries: Array<{
    date: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>;
}

export interface QuickWinOpportunity {
  query: string;
  page: string;
  position: number;
  impressions: number;
  clicks: number;
  ctr: number;
  expectedCtr: number;
  potentialAdditionalClicks: number;
  whyItMatters: string;
  recommendedAction: string;
}

export interface CtrGapItem {
  query: string;
  page: string;
  position: number;
  impressions: number;
  actualCtr: number;
  expectedCtr: number;
  ctrDeficitPct: number;
  missedClicksEstimate: number;
  recommendedFix: string;
}

export interface ContentDecayItem {
  page: string;
  topQuery: string;
  previousClicks: number;
  currentClicks: number;
  dropPct: number;
  previousPosition: number;
  currentPosition: number;
  severity: "critical" | "warning";
  recommendedFix: string;
}

export interface CannibalizationItem {
  query: string;
  totalImpressions: number;
  totalClicks: number;
  competingPages: Array<{
    page: string;
    impressions: number;
    clicks: number;
    impressionSharePct: number;
    avgPosition: number;
  }>;
  recommendedFix: string;
}

export interface WinnerLoserItem {
  query: string;
  page: string;
  previousClicks: number;
  currentClicks: number;
  deltaClicks: number;
  deltaPct: number;
  currentPosition: number;
}

export interface PerformanceAnomaly {
  date: string;
  direction: "spike" | "drop";
  clicks: number;
  baselineMeanClicks: number;
  zScore: number;
  severity: "critical" | "warning" | "info";
  title: string;
}

export interface PerformanceIntelligenceReport {
  hasData: boolean;
  dataSource: "google_oauth" | "demo_seed" | "none";
  overview: PerformanceOverviewKpis;
  quickWins: QuickWinOpportunity[];
  ctrGaps: CtrGapItem[];
  decay: ContentDecayItem[];
  cannibalization: CannibalizationItem[];
  winners: WinnerLoserItem[];
  losers: WinnerLoserItem[];
  anomalies: PerformanceAnomaly[];
}

/**
 * Industry-calibrated organic CTR curve by average position (labelled benchmark curve per §6).
 */
export function expectedCtrForPosition(position: number): number {
  if (position <= 1.5) return 0.275;
  if (position <= 2.5) return 0.155;
  if (position <= 3.5) return 0.105;
  if (position <= 4.5) return 0.075;
  if (position <= 5.5) return 0.058;
  if (position <= 7.5) return 0.042;
  if (position <= 10.5) return 0.028;
  if (position <= 15.5) return 0.016;
  if (position <= 20.5) return 0.011;
  return 0.005;
}

function computePercentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.floor((p / 100) * sortedAsc.length)),
  );
  return sortedAsc[idx]!;
}

/**
 * Pure, deterministic Performance Intelligence analyzer (§6).
 * Evaluates raw daily Search Console rows into Quick Wins, CTR Gaps, Content Decay,
 * Keyword Cannibalization, Winners/Losers, and Daily Click Anomalies.
 */
export function analyzeSearchPerformanceRows(
  rows: GscQueryRow[],
  dataSource: "google_oauth" | "demo_seed" | "none" = "google_oauth",
): PerformanceIntelligenceReport {
  if (rows.length === 0) {
    return {
      hasData: false,
      dataSource: "none",
      overview: {
        currentClicks: 0,
        previousClicks: 0,
        clicksDeltaPct: 0,
        currentImpressions: 0,
        previousImpressions: 0,
        impressionsDeltaPct: 0,
        currentCtr: 0,
        previousCtr: 0,
        currentPosition: 0,
        previousPosition: 0,
        dailySeries: [],
      },
      quickWins: [],
      ctrGaps: [],
      decay: [],
      cannibalization: [],
      winners: [],
      losers: [],
      anomalies: [],
    };
  }

  // Sort unique dates ascending
  const allDates = [...new Set(rows.map((r) => r.date))].sort();
  const midpointIdx = Math.max(1, Math.floor(allDates.length / 2));
  const recentCutoffDate = allDates[midpointIdx] ?? allDates[0]!;

  // Daily series aggregation
  const byDate = new Map<
    string,
    { clicks: number; impressions: number; weightedPos: number }
  >();
  for (const r of rows) {
    const cur = byDate.get(r.date) ?? { clicks: 0, impressions: 0, weightedPos: 0 };
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    cur.weightedPos += r.position * r.impressions;
    byDate.set(r.date, cur);
  }

  const dailySeries = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      clicks: d.clicks,
      impressions: d.impressions,
      ctr: d.impressions > 0 ? Number((d.clicks / d.impressions).toFixed(4)) : 0,
      position: d.impressions > 0 ? Number((d.weightedPos / d.impressions).toFixed(2)) : 0,
    }));

  // Split into previous period and current (recent) period
  let currentClicks = 0;
  let previousClicks = 0;
  let currentImpressions = 0;
  let previousImpressions = 0;
  let currentWeightedPos = 0;
  let previousWeightedPos = 0;

  interface WindowAgg {
    clicks: number;
    impressions: number;
    weightedPos: number;
  }

  const recentQueryPage = new Map<string, WindowAgg & { query: string; page: string }>();
  const prevQueryPage = new Map<string, WindowAgg & { query: string; page: string }>();
  const recentByPage = new Map<
    string,
    WindowAgg & { topQuery: string; topQueryClicks: number }
  >();
  const prevByPage = new Map<string, WindowAgg>();

  for (const r of rows) {
    const isRecent = allDates.length === 1 || r.date >= recentCutoffDate;
    const qpKey = `${r.query}|||${r.page}`;

    if (isRecent) {
      currentClicks += r.clicks;
      currentImpressions += r.impressions;
      currentWeightedPos += r.position * r.impressions;

      const qp = recentQueryPage.get(qpKey) ?? {
        query: r.query,
        page: r.page,
        clicks: 0,
        impressions: 0,
        weightedPos: 0,
      };
      qp.clicks += r.clicks;
      qp.impressions += r.impressions;
      qp.weightedPos += r.position * r.impressions;
      recentQueryPage.set(qpKey, qp);

      const pg = recentByPage.get(r.page) ?? {
        clicks: 0,
        impressions: 0,
        weightedPos: 0,
        topQuery: r.query,
        topQueryClicks: 0,
      };
      pg.clicks += r.clicks;
      pg.impressions += r.impressions;
      pg.weightedPos += r.position * r.impressions;
      if (r.clicks >= pg.topQueryClicks) {
        pg.topQuery = r.query;
        pg.topQueryClicks = r.clicks;
      }
      recentByPage.set(r.page, pg);
    } else {
      previousClicks += r.clicks;
      previousImpressions += r.impressions;
      previousWeightedPos += r.position * r.impressions;

      const qp = prevQueryPage.get(qpKey) ?? {
        query: r.query,
        page: r.page,
        clicks: 0,
        impressions: 0,
        weightedPos: 0,
      };
      qp.clicks += r.clicks;
      qp.impressions += r.impressions;
      qp.weightedPos += r.position * r.impressions;
      prevQueryPage.set(qpKey, qp);

      const pg = prevByPage.get(r.page) ?? {
        clicks: 0,
        impressions: 0,
        weightedPos: 0,
      };
      pg.clicks += r.clicks;
      pg.impressions += r.impressions;
      pg.weightedPos += r.position * r.impressions;
      prevByPage.set(r.page, pg);
    }
  }

  const clicksDeltaPct =
    previousClicks > 0
      ? Number((((currentClicks - previousClicks) / previousClicks) * 100).toFixed(1))
      : 0;
  const impressionsDeltaPct =
    previousImpressions > 0
      ? Number(
          (((currentImpressions - previousImpressions) / previousImpressions) * 100).toFixed(1),
        )
      : 0;

  const overview: PerformanceOverviewKpis = {
    currentClicks,
    previousClicks,
    clicksDeltaPct,
    currentImpressions,
    previousImpressions,
    impressionsDeltaPct,
    currentCtr:
      currentImpressions > 0
        ? Number((currentClicks / currentImpressions).toFixed(4))
        : 0,
    previousCtr:
      previousImpressions > 0
        ? Number((previousClicks / previousImpressions).toFixed(4))
        : 0,
    currentPosition:
      currentImpressions > 0
        ? Number((currentWeightedPos / currentImpressions).toFixed(2))
        : 0,
    previousPosition:
      previousImpressions > 0
        ? Number((previousWeightedPos / previousImpressions).toFixed(2))
        : 0,
    dailySeries,
  };

  // 1. Quick Wins (positions 4..20, impressions >= p50/p75 or >= 40)
  const recentItems = [...recentQueryPage.values()].map((item) => {
    const pos =
      item.impressions > 0
        ? Number((item.weightedPos / item.impressions).toFixed(2))
        : 0;
    const ctr =
      item.impressions > 0 ? Number((item.clicks / item.impressions).toFixed(4)) : 0;
    return {
      ...item,
      position: pos,
      ctr,
    };
  });

  const sortedImpressions = recentItems.map((i) => i.impressions).sort((a, b) => a - b);
  const impressionFloor = Math.max(25, computePercentile(sortedImpressions, 50));

  const quickWins: QuickWinOpportunity[] = [];
  const ctrGaps: CtrGapItem[] = [];

  for (const item of recentItems) {
    const expCtr = expectedCtrForPosition(item.position);
    const targetTop3Ctr = expectedCtrForPosition(Math.max(2, item.position - 3));

    // Quick win: ranking #4–#20 with meaningful impressions
    if (
      item.position >= 4.0 &&
      item.position <= 20.0 &&
      item.impressions >= impressionFloor
    ) {
      const potentialAdditionalClicks = Math.max(
        1,
        Math.round(item.impressions * Math.max(expCtr, targetTop3Ctr) - item.clicks),
      );
      quickWins.push({
        query: item.query,
        page: item.page,
        position: item.position,
        impressions: item.impressions,
        clicks: item.clicks,
        ctr: item.ctr,
        expectedCtr: expCtr,
        potentialAdditionalClicks,
        whyItMatters: `Already ranks at position ${item.position} with ${item.impressions.toLocaleString()} impressions. Moving up 2–3 positions or lifting CTR to the position benchmark can add ~${potentialAdditionalClicks} organic clicks per period without creating a new page.`,
        recommendedAction: `Add "${item.query}" to an H2/H3 section on ${item.page}, answer the query directly in the first 50 words of that section, and add 2–3 internal links using "${item.query}" as anchor text.`,
      });
    }

    // CTR Gap: actual CTR < 70% of expected CTR for its current position
    if (item.impressions >= impressionFloor && item.ctr < expCtr * 0.72) {
      const missedClicks = Math.max(1, Math.round(item.impressions * expCtr - item.clicks));
      const deficitPct = Number((((expCtr - item.ctr) / expCtr) * 100).toFixed(1));
      ctrGaps.push({
        query: item.query,
        page: item.page,
        position: item.position,
        impressions: item.impressions,
        actualCtr: item.ctr,
        expectedCtr: expCtr,
        ctrDeficitPct: deficitPct,
        missedClicksEstimate: missedClicks,
        recommendedFix: `Rewrite the <title> (50–60 chars) and meta description (140–155 chars) on ${item.page} to front-load "${item.query}", include a concrete outcome or number, and add FAQ/Article schema markup.`,
      });
    }
  }

  quickWins.sort((a, b) => b.potentialAdditionalClicks - a.potentialAdditionalClicks);
  ctrGaps.sort((a, b) => b.missedClicksEstimate - a.missedClicksEstimate);

  // 2. Content Decay: pages whose clicks dropped >= 30% in recent period vs previous period
  const decay: ContentDecayItem[] = [];
  for (const [pageUrl, prev] of prevByPage.entries()) {
    if (prev.clicks < 8) continue;
    const cur = recentByPage.get(pageUrl);
    const curClicks = cur?.clicks ?? 0;
    const dropRatio = (prev.clicks - curClicks) / prev.clicks;

    if (dropRatio >= 0.3) {
      const dropPct = Number((dropRatio * 100).toFixed(1));
      const prevPos =
        prev.impressions > 0 ? Number((prev.weightedPos / prev.impressions).toFixed(2)) : 0;
      const curPos =
        cur && cur.impressions > 0
          ? Number((cur.weightedPos / cur.impressions).toFixed(2))
          : prevPos;

      decay.push({
        page: pageUrl,
        topQuery: cur?.topQuery ?? "primary topic",
        previousClicks: prev.clicks,
        currentClicks: curClicks,
        dropPct,
        previousPosition: prevPos,
        currentPosition: curPos,
        severity: dropRatio >= 0.45 ? "critical" : "warning",
        recommendedFix: `Refresh outdated statistics and examples on ${pageUrl}, align the opening answer with current SERP intent for "${cur?.topQuery ?? "target keyword"}", and update the visible "Last reviewed" date.`,
      });
    }
  }
  decay.sort((a, b) => b.dropPct - a.dropPct);

  // 3. Keyword Cannibalization: >= 2 URLs splitting impressions for the same query
  const byQueryPages = new Map<
    string,
    Array<{ page: string; impressions: number; clicks: number; avgPosition: number }>
  >();
  for (const item of recentItems) {
    const arr = byQueryPages.get(item.query) ?? [];
    arr.push({
      page: item.page,
      impressions: item.impressions,
      clicks: item.clicks,
      avgPosition: item.position,
    });
    byQueryPages.set(item.query, arr);
  }

  const cannibalization: CannibalizationItem[] = [];
  for (const [query, pageEntries] of byQueryPages.entries()) {
    if (pageEntries.length < 2) continue;
    const totalImpr = pageEntries.reduce((acc, p) => acc + p.impressions, 0);
    const totalClk = pageEntries.reduce((acc, p) => acc + p.clicks, 0);
    if (totalImpr < 30) continue;

    const sortedPages = [...pageEntries]
      .map((p) => ({
        ...p,
        impressionSharePct: Number(((p.impressions / totalImpr) * 100).toFixed(1)),
      }))
      .filter((p) => p.impressionSharePct >= 15)
      .sort((a, b) => b.impressions - a.impressions);

    // If at least 2 URLs each capture >= 15% of impressions (neither dominates > 85%)
    if (sortedPages.length >= 2 && sortedPages[0]!.impressionSharePct <= 85) {
      cannibalization.push({
        query,
        totalImpressions: totalImpr,
        totalClicks: totalClk,
        competingPages: sortedPages,
        recommendedFix: `Designate ${sortedPages[0]!.page} as the primary canonical target for "${query}". Differentiate or merge overlapping sections from ${sortedPages[1]!.page}, and point internal anchor links for "${query}" exclusively to ${sortedPages[0]!.page}.`,
      });
    }
  }
  cannibalization.sort((a, b) => b.totalImpressions - a.totalImpressions);

  // 4. Winners & Losers (query+page click delta)
  const allQpKeys = new Set([...recentQueryPage.keys(), ...prevQueryPage.keys()]);
  const deltas: WinnerLoserItem[] = [];
  for (const k of allQpKeys) {
    const cur = recentQueryPage.get(k);
    const prev = prevQueryPage.get(k);
    const curClicks = cur?.clicks ?? 0;
    const prevClicks = prev?.clicks ?? 0;
    const deltaClicks = curClicks - prevClicks;
    if (deltaClicks === 0) continue;

    const query = cur?.query ?? prev?.query ?? "";
    const page = cur?.page ?? prev?.page ?? "";
    const curPos =
      cur && cur.impressions > 0
        ? Number((cur.weightedPos / cur.impressions).toFixed(2))
        : 0;
    const deltaPct =
      prevClicks > 0
        ? Number(((deltaClicks / prevClicks) * 100).toFixed(1))
        : 100;

    deltas.push({
      query,
      page,
      previousClicks: prevClicks,
      currentClicks: curClicks,
      deltaClicks,
      deltaPct,
      currentPosition: curPos,
    });
  }

  const winners = deltas
    .filter((d) => d.deltaClicks > 0)
    .sort((a, b) => b.deltaClicks - a.deltaClicks)
    .slice(0, 6);
  const losers = deltas
    .filter((d) => d.deltaClicks < 0)
    .sort((a, b) => a.deltaClicks - b.deltaClicks)
    .slice(0, 6);

  // 5. Daily Click Anomaly Detection (rolling z-score)
  const anomalies: PerformanceAnomaly[] = [];
  if (dailySeries.length >= 7) {
    const clickValues = dailySeries.map((d) => d.clicks);
    const mean = clickValues.reduce((a, b) => a + b, 0) / clickValues.length;
    const variance =
      clickValues.reduce((acc, v) => acc + (v - mean) ** 2, 0) / clickValues.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev > 1) {
      for (const day of dailySeries.slice(-14)) {
        const z = (day.clicks - mean) / stdDev;
        if (Math.abs(z) >= 2.5) {
          const direction = z > 0 ? "spike" : "drop";
          const severity = Math.abs(z) >= 3.0 ? "critical" : "warning";
          anomalies.push({
            date: day.date,
            direction,
            clicks: day.clicks,
            baselineMeanClicks: Number(mean.toFixed(1)),
            zScore: Number(z.toFixed(2)),
            severity: direction === "drop" ? severity : "info",
            title:
              direction === "drop"
                ? `Unusual organic traffic drop on ${day.date} (${day.clicks} clicks vs ${mean.toFixed(0)} avg, z=${z.toFixed(1)})`
                : `Organic traffic spike on ${day.date} (${day.clicks} clicks vs ${mean.toFixed(0)} avg, z=+${z.toFixed(1)})`,
          });
        }
      }
    }
  }

  return {
    hasData: true,
    dataSource,
    overview,
    quickWins: quickWins.slice(0, 10),
    ctrGaps: ctrGaps.slice(0, 10),
    decay: decay.slice(0, 10),
    cannibalization: cannibalization.slice(0, 10),
    winners,
    losers,
    anomalies,
  };
}

/**
 * Loads `search_performance` rows for `projectId` and computes the full Performance Intelligence report.
 */
export async function getProjectPerformanceIntelligence(
  userId: string,
  projectId: string,
): Promise<PerformanceIntelligenceReport> {
  const cutoffDate = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const connStatus = await getGoogleConnectionStatus(userId, projectId);

  const rows = await withUserDb(userId, async (tx) => {
    await assertProjectAccess(tx, userId, projectId, "viewer");
    return tx
      .select()
      .from(searchPerformance)
      .where(
        and(
          eq(searchPerformance.projectId, projectId),
          gte(searchPerformance.date, cutoffDate),
        ),
      )
      .orderBy(desc(searchPerformance.date));
  });

  const dataSource: "google_oauth" | "demo_seed" | "none" =
    rows.length === 0 ? "none" : connStatus.connected ? "google_oauth" : "demo_seed";

  const report = analyzeSearchPerformanceRows(rows, dataSource);

  // Persist critical drop anomalies into `alerts` if any were detected
  if (report.anomalies.some((a) => a.direction === "drop")) {
    await withUserDb(userId, async (tx) => {
      const existingAlerts = await tx
        .select({ title: alerts.title })
        .from(alerts)
        .where(and(eq(alerts.projectId, projectId), eq(alerts.kind, "traffic_anomaly")))
        .limit(20);
      const seenTitles = new Set(existingAlerts.map((a) => a.title));

      for (const anomaly of report.anomalies) {
        if (anomaly.direction !== "drop" || seenTitles.has(anomaly.title)) continue;
        await tx.insert(alerts).values({
          projectId,
          kind: "traffic_anomaly",
          severity: anomaly.severity,
          title: anomaly.title,
          data: anomaly,
        });
      }
    });
  }

  return report;
}
