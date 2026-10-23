import { and, desc, eq, sql } from "drizzle-orm";
import { withUserDb } from "@/lib/db/rls";
import {
  keywordClusters,
  keywords,
  pages,
  projects,
  rankHistory,
  searchPerformance,
  type SearchIntent,
} from "@/lib/db/schema";
import { classifySearchIntent } from "@/lib/onpage/optimizer";
import { assertProjectAccess } from "@/lib/security/authz";

export interface KeywordRowDto {
  id: string;
  clusterId: string | null;
  clusterName: string | null;
  keyword: string;
  normalized: string;
  intent: SearchIntent | null;
  intentConfidence: number | null;
  /** Strictly null unless a volume data provider supplied a real number (§4.1). */
  volume: number | null;
  volumeSource: string | null;
  difficultyEst: number | null;
  difficultyConfidence: number | null;
  gscImpressions28d: number | null;
  gscPosition: number | null;
  priority: number;
  sources: string[];
  tracked: boolean;
  rankHistory: Array<{
    date: string;
    position: number | null;
    url: string | null;
    source: "gsc" | "serp_provider";
  }>;
}

export interface KeywordClusterDto {
  id: string;
  name: string;
  intent: SearchIntent | null;
  pillarKeyword: string | null;
  priority: number;
  rationale: string | null;
  keywordsCount: number;
  totalImpressions28d: number;
}

export interface ProjectKeywordsOverview {
  keywords: KeywordRowDto[];
  clusters: KeywordClusterDto[];
  honestPolicyNotice: string;
}

const CLUSTER_STOP_WORDS = new Set([
  "how",
  "what",
  "why",
  "when",
  "where",
  "best",
  "top",
  "for",
  "with",
  "and",
  "the",
  "guide",
  "tutorial",
  "checklist",
  "free",
  "online",
  "tool",
  "tools",
  "software",
  "vs",
  "review",
  "reviews",
  "pricing",
  "cost",
]);

export function normalizeKeywordText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Estimates keyword difficulty (0–100) with explicit confidence score (0–1).
 * Always labeled as an estimate in the UI (`difficultyEst` + `difficultyConfidence`).
 */
export function estimateKeywordDifficulty(params: {
  keyword: string;
  intent: SearchIntent;
  gscPosition?: number | null;
}): { difficultyEst: number; difficultyConfidence: number } {
  const words = normalizeKeywordText(params.keyword).split(" ").filter(Boolean);
  const wordCount = words.length;

  // Shorter head terms are harder; 4+ word long-tail terms are more accessible
  let base =
    wordCount <= 1
      ? 78
      : wordCount === 2
        ? 64
        : wordCount === 3
          ? 48
          : wordCount === 4
            ? 36
            : 26;

  if (params.intent === "transactional" || params.intent === "commercial") {
    base += 10;
  }

  // If the project already ranks in top 20 in GSC, effective difficulty for this domain is lower
  if (params.gscPosition && params.gscPosition > 0 && params.gscPosition <= 20) {
    base = Math.max(15, Math.round(base * 0.75));
  }

  const difficultyEst = Math.max(10, Math.min(95, base));
  const difficultyConfidence = params.gscPosition ? 0.68 : 0.45;
  return { difficultyEst, difficultyConfidence };
}

/**
 * Computes a deterministic 0–100 keyword priority score combining:
 * - Intent business value
 * - GSC quick-win proximity (positions 4–20 get highest boost)
 * - Demand proxy (GSC impressions or provider volume)
 * - Accessibility (`100 - difficultyEst`)
 */
export function computeKeywordPriority(params: {
  intent: SearchIntent;
  difficultyEst: number;
  gscImpressions28d?: number | null;
  gscPosition?: number | null;
  volume?: number | null;
}): number {
  const intentPoints =
    params.intent === "transactional"
      ? 28
      : params.intent === "commercial"
        ? 25
        : params.intent === "informational"
          ? 20
          : 12;

  const accessibilityPoints = Math.round(((100 - params.difficultyEst) / 100) * 30);

  let demandPoints = 12;
  const demandSignal = params.volume ?? params.gscImpressions28d ?? 0;
  if (demandSignal >= 1000) demandPoints = 22;
  else if (demandSignal >= 300) demandPoints = 18;
  else if (demandSignal >= 50) demandPoints = 14;

  let positionBonus = 8;
  if (params.gscPosition && params.gscPosition >= 4 && params.gscPosition <= 20) {
    // Striking-distance quick win!
    positionBonus = 20;
  } else if (params.gscPosition && params.gscPosition < 4) {
    positionBonus = 14;
  }

  return Math.max(5, Math.min(100, intentPoints + accessibilityPoints + demandPoints + positionBonus));
}

/**
 * Groups normalized keywords into topic clusters by extracting their core semantic stem.
 */
export function deriveClusterTopicKey(keyword: string): {
  key: string;
  displayName: string;
} {
  const tokens = normalizeKeywordText(keyword)
    .split(" ")
    .filter((w) => w.length >= 3 && !CLUSTER_STOP_WORDS.has(w));

  const stemTokens = tokens.slice(0, 2);
  const key = stemTokens.length > 0 ? stemTokens.join(" ") : normalizeKeywordText(keyword);
  const displayName = key
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return {
    key,
    displayName: `${displayName} Cluster`,
  };
}

/**
 * Expands a list of seed phrases into structured keyword candidates covering
 * informational (PAA/how-to), commercial (comparison/best), and actionable variations.
 */
export function expandSeedKeywords(seeds: string[]): Array<{
  keyword: string;
  source: string;
}> {
  const results = new Map<string, { keyword: string; source: string }>();

  for (const rawSeed of seeds) {
    const clean = normalizeKeywordText(rawSeed);
    if (clean.length < 3) continue;

    results.set(clean, { keyword: clean, source: "seed" });

    if (clean.split(" ").length <= 3) {
      const variations: Array<{ kw: string; src: string }> = [
        { kw: `how to ${clean}`, src: "paa_expansion" },
        { kw: `${clean} checklist`, src: "autocomplete_expansion" },
        { kw: `best ${clean} guide`, src: "autocomplete_expansion" },
        { kw: `${clean} best practices`, src: "paa_expansion" },
      ];
      for (const v of variations) {
        const norm = normalizeKeywordText(v.kw);
        if (!results.has(norm)) {
          results.set(norm, { keyword: norm, source: v.src });
        }
      }
    }
  }

  return Array.from(results.values()).slice(0, 40);
}

/**
 * Lists all keywords, topic clusters, and rank history for a project.
 */
export async function listProjectKeywords(
  userId: string,
  projectId: string,
): Promise<ProjectKeywordsOverview> {
  return withUserDb(userId, async (tx) => {
    await assertProjectAccess(tx, userId, projectId, "viewer");
    const clusterRows = await tx
      .select()
      .from(keywordClusters)
      .where(eq(keywordClusters.projectId, projectId))
      .orderBy(desc(keywordClusters.priority));

    const kwRows = await tx
      .select()
      .from(keywords)
      .where(eq(keywords.projectId, projectId))
      .orderBy(desc(keywords.priority), desc(keywords.gscImpressions28d));

    const historyRows = await tx
      .select()
      .from(rankHistory)
      .where(eq(rankHistory.projectId, projectId))
      .orderBy(rankHistory.date);

    const historyByKw = new Map<
      string,
      Array<{
        date: string;
        position: number | null;
        url: string | null;
        source: "gsc" | "serp_provider";
      }>
    >();

    for (const h of historyRows) {
      const list = historyByKw.get(h.keywordId) ?? [];
      list.push({
        date: h.date,
        position: h.position,
        url: h.url,
        source: h.source,
      });
      historyByKw.set(h.keywordId, list);
    }

    const clusterById = new Map(clusterRows.map((c) => [c.id, c]));
    const clusterStats = new Map<string, { count: number; impressions: number }>();

    for (const kw of kwRows) {
      if (kw.clusterId) {
        const prev = clusterStats.get(kw.clusterId) ?? { count: 0, impressions: 0 };
        prev.count += 1;
        prev.impressions += kw.gscImpressions28d ?? 0;
        clusterStats.set(kw.clusterId, prev);
      }
    }

    return {
      keywords: kwRows.map((kw) => ({
        id: kw.id,
        clusterId: kw.clusterId,
        clusterName: kw.clusterId ? (clusterById.get(kw.clusterId)?.name ?? null) : null,
        keyword: kw.keyword,
        normalized: kw.normalized,
        intent: kw.intent,
        intentConfidence: kw.intentConfidence,
        volume: kw.volume,
        volumeSource: kw.volumeSource,
        difficultyEst: kw.difficultyEst,
        difficultyConfidence: kw.difficultyConfidence,
        gscImpressions28d: kw.gscImpressions28d,
        gscPosition: kw.gscPosition,
        priority: kw.priority,
        sources: kw.sources ?? [],
        tracked: kw.tracked,
        rankHistory: historyByKw.get(kw.id) ?? [],
      })),
      clusters: clusterRows.map((c) => {
        const st = clusterStats.get(c.id) ?? { count: 0, impressions: 0 };
        return {
          id: c.id,
          name: c.name,
          intent: c.intent,
          pillarKeyword: c.pillarKeyword,
          priority: c.priority,
          rationale: c.rationale,
          keywordsCount: st.count,
          totalImpressions28d: st.impressions,
        };
      }),
      honestPolicyNotice:
        "Honest Volume Policy (§4.1): Monthly search volume is only displayed when supplied by a connected volume provider (DataForSEO / SerpAPI / Serper). Otherwise, 28-day Search Console impressions are shown as measured demand, and difficulty is labeled as an estimate with confidence score.",
    };
  });
}

/**
 * Runs keyword research & seed expansion for a project, combining:
 * 1. User-supplied seed keywords
 * 2. Stored Search Console queries (`search_performance`)
 * 3. Crawled page titles / H1s (`pages`)
 * Upserts topic clusters (`keyword_clusters`), keywords (`keywords`), and `rank_history`.
 */
export async function runKeywordResearch(params: {
  userId: string;
  projectId: string;
  seedKeywords?: string[];
  autoTrackTop?: boolean;
}): Promise<ProjectKeywordsOverview> {
  await withUserDb(params.userId, async (tx) => {
    await assertProjectAccess(tx, params.userId, params.projectId, "editor");
    const [project] = await tx
      .select({ name: projects.name, host: projects.host })
      .from(projects)
      .where(eq(projects.id, params.projectId))
      .limit(1);

    // 1. Gather GSC queries
    const gscAgg = await tx
      .select({
        query: searchPerformance.query,
        impressions: sql<number>`sum(${searchPerformance.impressions})::int`,
        avgPos: sql<number>`avg(${searchPerformance.position})::real`,
        topPage: sql<string>`max(${searchPerformance.page})`,
      })
      .from(searchPerformance)
      .where(eq(searchPerformance.projectId, params.projectId))
      .groupBy(searchPerformance.query)
      .orderBy(desc(sql`sum(${searchPerformance.impressions})`))
      .limit(30);

    const gscByNorm = new Map<
      string,
      { impressions: number; avgPos: number; topPage: string | null }
    >();
    for (const row of gscAgg) {
      const norm = normalizeKeywordText(row.query);
      if (norm) {
        gscByNorm.set(norm, {
          impressions: Number(row.impressions ?? 0),
          avgPos: Number(row.avgPos ?? 0),
          topPage: row.topPage ?? null,
        });
      }
    }

    // 2. Gather crawled page H1/Title topics if seeds are empty
    const crawledPages = await tx
      .select({ title: pages.title, h1: pages.h1 })
      .from(pages)
      .where(eq(pages.projectId, params.projectId))
      .limit(15);

    const pageSeeds: string[] = [];
    for (const p of crawledPages) {
      if (p.h1?.[0]) pageSeeds.push(p.h1[0].split(/[|—–:-]/)[0]!.trim());
      else if (p.title) pageSeeds.push(p.title.split(/[|—–:-]/)[0]!.trim());
    }

    const baseSeeds = [
      ...(params.seedKeywords ?? []),
      ...Array.from(gscByNorm.keys()).slice(0, 12),
      ...pageSeeds.slice(0, 6),
    ];

    if (baseSeeds.length === 0) {
      const domainStem = (project?.host ?? "website").split(".")[0] ?? "website";
      baseSeeds.push(
        `${domainStem} seo audit`,
        "technical seo checklist",
        "core web vitals optimization",
        "on page seo guide",
      );
    }

    const expanded = expandSeedKeywords(baseSeeds);
    for (const [normKey] of gscByNorm) {
      if (!expanded.some((e) => e.keyword === normKey)) {
        expanded.push({ keyword: normKey, source: "gsc" });
      }
    }

    // Group into clusters
    const existingClusters = await tx
      .select()
      .from(keywordClusters)
      .where(eq(keywordClusters.projectId, params.projectId));
    const clusterByName = new Map(existingClusters.map((c) => [c.name.toLowerCase(), c]));

    for (let idx = 0; idx < expanded.length; idx++) {
      const item = expanded[idx]!;
      const norm = normalizeKeywordText(item.keyword);
      if (!norm) continue;

      const gscInfo = gscByNorm.get(norm);
      const intentInfo = classifySearchIntent(norm);
      const diff = estimateKeywordDifficulty({
        keyword: norm,
        intent: intentInfo.intent,
        gscPosition: gscInfo?.avgPos ?? null,
      });
      const priority = computeKeywordPriority({
        intent: intentInfo.intent,
        difficultyEst: diff.difficultyEst,
        gscImpressions28d: gscInfo?.impressions ?? null,
        gscPosition: gscInfo?.avgPos ?? null,
        volume: null, // Strictly null unless external volume API is used
      });

      const clusterInfo = deriveClusterTopicKey(norm);
      let clusterRow = clusterByName.get(clusterInfo.displayName.toLowerCase());
      if (!clusterRow) {
        const [insertedCluster] = await tx
          .insert(keywordClusters)
          .values({
            projectId: params.projectId,
            name: clusterInfo.displayName,
            intent: intentInfo.intent,
            pillarKeyword: norm,
            priority,
            rationale: `Grouped around topic stem '${clusterInfo.key}' (${intentInfo.intent} intent).`,
          })
          .returning();
        clusterRow = insertedCluster!;
        clusterByName.set(clusterInfo.displayName.toLowerCase(), clusterRow);
      }

      const sources = Array.from(
        new Set([item.source, ...(gscInfo ? ["gsc"] : [])]),
      );
      const shouldTrack =
        Boolean(params.autoTrackTop ?? true) && (Boolean(gscInfo) || idx < 8);

      const [upsertedKw] = await tx
        .insert(keywords)
        .values({
          projectId: params.projectId,
          clusterId: clusterRow.id,
          keyword: norm,
          normalized: norm,
          intent: intentInfo.intent,
          intentConfidence: intentInfo.confidence,
          volume: null,
          volumeSource: null,
          difficultyEst: diff.difficultyEst,
          difficultyConfidence: diff.difficultyConfidence,
          gscImpressions28d: gscInfo?.impressions ?? null,
          gscPosition: gscInfo ? Math.round(gscInfo.avgPos * 10) / 10 : null,
          priority,
          sources,
          tracked: shouldTrack,
        })
        .onConflictDoUpdate({
          target: [keywords.projectId, keywords.normalized],
          set: {
            clusterId: clusterRow.id,
            intent: intentInfo.intent,
            intentConfidence: intentInfo.confidence,
            difficultyEst: diff.difficultyEst,
            difficultyConfidence: diff.difficultyConfidence,
            gscImpressions28d: gscInfo?.impressions ?? sql`${keywords.gscImpressions28d}`,
            gscPosition: gscInfo
              ? Math.round(gscInfo.avgPos * 10) / 10
              : sql`${keywords.gscPosition}`,
            priority,
            updatedAt: new Date(),
          },
        })
        .returning();

      // If we have daily GSC rows for this query, sync them into `rank_history`
      if (upsertedKw && gscInfo) {
        const dailyRows = await tx
          .select({
            date: searchPerformance.date,
            avgPos: sql<number>`avg(${searchPerformance.position})::real`,
            topPage: sql<string>`max(${searchPerformance.page})`,
          })
          .from(searchPerformance)
          .where(
            and(
              eq(searchPerformance.projectId, params.projectId),
              eq(searchPerformance.query, norm),
            ),
          )
          .groupBy(searchPerformance.date)
          .orderBy(desc(searchPerformance.date))
          .limit(14);

        for (const d of dailyRows) {
          await tx
            .insert(rankHistory)
            .values({
              projectId: params.projectId,
              keywordId: upsertedKw.id,
              date: d.date,
              position: Math.round(Number(d.avgPos) * 10) / 10,
              url: d.topPage,
              source: "gsc",
            })
            .onConflictDoUpdate({
              target: [rankHistory.keywordId, rankHistory.date, rankHistory.source],
              set: {
                position: Math.round(Number(d.avgPos) * 10) / 10,
                url: d.topPage,
              },
            });
        }
      }
    }
  });

  return listProjectKeywords(params.userId, params.projectId);
}

/**
 * Updates a keyword's `tracked` status or target `priority`.
 */
export async function updateKeywordTracking(params: {
  userId: string;
  keywordId: string;
  tracked?: boolean;
}): Promise<{ id: string; tracked: boolean }> {
  return withUserDb(params.userId, async (tx) => {
    const [updated] = await tx
      .update(keywords)
      .set({
        ...(params.tracked !== undefined ? { tracked: params.tracked } : {}),
        updatedAt: new Date(),
      })
      .where(eq(keywords.id, params.keywordId))
      .returning({ id: keywords.id, tracked: keywords.tracked });

    if (!updated) {
      throw new Error("Keyword not found");
    }
    return updated;
  });
}
