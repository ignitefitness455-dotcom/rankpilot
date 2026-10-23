import { and, desc, eq, ne } from "drizzle-orm";
import { withUserDb } from "@/lib/db/rls";
import {
  links,
  pages,
  projects,
  searchPerformance,
  type SearchIntent,
} from "@/lib/db/schema";
import { generateSchemaJsonLd } from "@/lib/schema-gen/generator";
import { assertProjectAccess, NotFoundError } from "@/lib/security/authz";

export interface TitleMetaVariant {
  id: "primary" | "value_hook" | "concise";
  label: string;
  rationale: string;
  title: string;
  titleChars: number;
  titlePixelEst: number;
  titleStatus: "optimal" | "short" | "long";
  metaDescription: string;
  metaChars: number;
  metaPixelEst: number;
  metaStatus: "optimal" | "short" | "long";
}

export interface InternalLinkOpportunity {
  sourcePageId: string;
  sourceUrl: string;
  sourceTitle: string | null;
  sourceInlinks: number;
  suggestedAnchorText: string;
  rationale: string;
}

export interface HeadingRecommendation {
  level: "H1" | "H2" | "H3";
  action: "keep" | "rewrite" | "add";
  currentText: string | null;
  suggestedText: string;
  reason: string;
}

export interface OnPageOptimizationReport {
  pageId: string;
  url: string;
  targetKeyword: string;
  inferredFrom: "user_input" | "gsc_top_query" | "h1_or_title" | "url_slug";
  intent: SearchIntent;
  intentConfidence: number;
  intentMatchScore: number;
  intentRationale: string;
  onPageScore: number;
  entitiesPresent: string[];
  entitiesMissing: string[];
  variants: TitleMetaVariant[];
  headingOutlineFixes: HeadingRecommendation[];
  internalLinkOpportunities: InternalLinkOpportunity[];
  suggestedFaqs: Array<{ question: string; answer: string }>;
  recommendedSchemaType: "Article" | "FAQPage" | "SoftwareApplication" | "Product";
  recommendedSchemaSnippet: string;
  evaluatedAt: string;
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "your",
  "how",
  "what",
  "why",
  "when",
  "where",
  "into",
  "about",
  "over",
  "under",
  "more",
  "best",
  "guide",
  "home",
  "page",
  "index",
  "html",
  "http",
  "https",
  "www",
]);

/**
 * Deterministically classifies a search query's primary intent and confidence score.
 */
export function classifySearchIntent(query: string): {
  intent: SearchIntent;
  confidence: number;
  rationale: string;
} {
  const q = query.toLowerCase().trim();

  if (/\b(buy|price|pricing|cost|discount|coupon|deal|subscribe|order|hire|download|trial|demo)\b/.test(q)) {
    return {
      intent: "transactional",
      confidence: 0.88,
      rationale: "Contains purchase, pricing, or conversion action modifiers.",
    };
  }

  if (/\b(best|top|vs|versus|compare|comparison|review|reviews|alternatives|software|tool|tools|platform|agency)\b/.test(q)) {
    return {
      intent: "commercial",
      confidence: 0.85,
      rationale: "Contains evaluation, comparison, or solution-research modifiers.",
    };
  }

  if (/\b(login|sign in|signin|portal|dashboard|contact|support|docs|status)\b/.test(q)) {
    return {
      intent: "navigational",
      confidence: 0.84,
      rationale: "Targets a specific brand destination or account utility endpoint.",
    };
  }

  if (/\b(how|what|why|when|where|guide|tutorial|checklist|examples|template|meaning|audit|fix)\b/.test(q)) {
    return {
      intent: "informational",
      confidence: 0.9,
      rationale: "Contains question, educational, or problem-solving modifiers.",
    };
  }

  return {
    intent: "informational",
    confidence: 0.72,
    rationale: "General topic query; defaults to informational/educational intent.",
  };
}

/**
 * Infers the primary target keyword for a page when not explicitly supplied.
 */
export function inferTargetKeyword(params: {
  explicitKeyword?: string | null;
  topGscQuery?: string | null;
  h1?: string[] | null;
  title?: string | null;
  url: string;
}): { keyword: string; source: OnPageOptimizationReport["inferredFrom"] } {
  if (params.explicitKeyword && params.explicitKeyword.trim().length >= 2) {
    return { keyword: params.explicitKeyword.trim(), source: "user_input" };
  }

  if (params.topGscQuery && params.topGscQuery.trim().length >= 2) {
    return { keyword: params.topGscQuery.trim(), source: "gsc_top_query" };
  }

  const firstH1 = params.h1?.[0]?.trim();
  if (firstH1 && firstH1.length >= 3) {
    const cleaned = firstH1.split(/[|—–:-]/)[0]?.trim() ?? firstH1;
    return {
      keyword: cleaned.toLowerCase().slice(0, 60),
      source: "h1_or_title",
    };
  }

  if (params.title && params.title.trim().length >= 3) {
    const cleaned = params.title.split(/[|—–:-]/)[0]?.trim() ?? params.title.trim();
    return {
      keyword: cleaned.toLowerCase().slice(0, 60),
      source: "h1_or_title",
    };
  }

  try {
    const parsed = new URL(params.url);
    const segments = parsed.pathname
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
    const lastSeg = segments[segments.length - 1];
    if (lastSeg) {
      const slugWords = lastSeg
        .replace(/\.(html|htm|php|aspx)$/i, "")
        .replace(/[-_]+/g, " ")
        .trim();
      if (slugWords.length >= 2) {
        return { keyword: slugWords.toLowerCase(), source: "url_slug" };
      }
    }
    return {
      keyword: parsed.hostname.replace(/^www\./, "").split(".")[0] + " seo guide",
      source: "url_slug",
    };
  } catch {
    return { keyword: "technical seo optimization", source: "url_slug" };
  }
}

function toTitleCase(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word.length <= 2 && /^(in|on|at|to|of|by|or|vs)$/i.test(word)) {
        return word.toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function clampLength(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const sliced = text.slice(0, maxChars - 1);
  const lastSpace = sliced.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.6 ? sliced.slice(0, lastSpace) : sliced).trim();
}

/**
 * Generates 3 white-hat `<title>` and `<meta name="description">` variants with live
 * character counts and pixel-width estimates (`30–60` chars for title, `120–160` for meta).
 */
export function buildTitleMetaVariants(params: {
  targetKeyword: string;
  brandName: string;
  intent: SearchIntent;
}): TitleMetaVariant[] {
  const kwTitle = toTitleCase(params.targetKeyword);
  const brand = params.brandName.trim() || "Site";

  const rawConfigs: Array<{
    id: TitleMetaVariant["id"];
    label: string;
    rationale: string;
    title: string;
    meta: string;
  }> = [
    {
      id: "primary",
      label: "Variant 1 — Exact Intent Match",
      rationale:
        "Front-loads the target keyword for maximum relevance and pairs it with a clear brand suffix under 60 characters.",
      title: clampLength(`${kwTitle}: Complete Guide & Best Practices | ${brand}`, 59),
      meta: clampLength(
        `Learn ${params.targetKeyword.toLowerCase()} with step-by-step benchmarks, real implementation examples, and actionable checklists from ${brand}. Explore the full guide today.`,
        156,
      ),
    },
    {
      id: "value_hook",
      label: "Variant 2 — High-CTR Value Hook",
      rationale:
        "Designed to lift organic CTR on positions 4–15 by highlighting concrete outcomes, checklists, and verified steps.",
      title: clampLength(
        params.intent === "commercial" || params.intent === "transactional"
          ? `${kwTitle} Compared: Features, Benchmarks & ROI (${brand})`
          : `How to Master ${kwTitle}: Actionable Checklist | ${brand}`,
        59,
      ),
      meta: clampLength(
        `Looking for proven ${params.targetKeyword.toLowerCase()} results? Compare key metrics, avoid common pitfalls, and apply our verified workflow with ${brand} to grow faster.`,
        156,
      ),
    },
    {
      id: "concise",
      label: "Variant 3 — Concise & Direct (Mobile-First)",
      rationale:
        "Compact pixel width engineered to avoid truncation on narrow mobile SERPs while preserving core entity signals.",
      title: clampLength(`${kwTitle} — Practical Framework & Guide | ${brand}`, 55),
      meta: clampLength(
        `Discover how ${params.targetKeyword.toLowerCase()} works in practice. Get clear technical guidance, schema templates, and measurable benchmarks from ${brand}.`,
        152,
      ),
    },
  ];

  return rawConfigs.map((cfg) => {
    // Ensure title is at least 30 chars
    const paddedTitle =
      cfg.title.length < 32
        ? clampLength(`${cfg.title} — Complete Overview`, 58)
        : cfg.title;
    // Ensure meta is at least 120 chars
    const paddedMeta =
      cfg.meta.length < 120
        ? clampLength(
            `${cfg.meta} Updated with verified examples and technical checklists.`,
            158,
          )
        : cfg.meta;

    const titleChars = paddedTitle.length;
    const titlePixelEst = Math.round(titleChars * 8.5);
    const metaChars = paddedMeta.length;
    const metaPixelEst = Math.round(metaChars * 6.8);

    return {
      id: cfg.id,
      label: cfg.label,
      rationale: cfg.rationale,
      title: paddedTitle,
      titleChars,
      titlePixelEst,
      titleStatus:
        titleChars >= 30 && titleChars <= 60
          ? "optimal"
          : titleChars < 30
            ? "short"
            : "long",
      metaDescription: paddedMeta,
      metaChars,
      metaPixelEst,
      metaStatus:
        metaChars >= 120 && metaChars <= 160
          ? "optimal"
          : metaChars < 120
            ? "short"
            : "long",
    };
  });
}

function extractCoreEntities(targetKeyword: string, headings: Array<{ level: number; text: string }>, summary: string | null): {
  present: string[];
  missing: string[];
} {
  const kwTokens = targetKeyword
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

  const candidateSubtopics = [
    ...kwTokens,
    "implementation checklist",
    "benchmarks & metrics",
    "common mistakes",
    "frequently asked questions",
    "step-by-step workflow",
    "verification & testing",
  ];

  const corpus = [
    ...headings.map((h) => h.text.toLowerCase()),
    (summary ?? "").toLowerCase(),
  ].join(" ");

  const present: string[] = [];
  const missing: string[] = [];

  for (const item of candidateSubtopics) {
    const token = item.split(/\s+/)[0] ?? item;
    if (corpus.includes(token.toLowerCase())) {
      present.push(item);
    } else {
      missing.push(item);
    }
  }

  return {
    present: Array.from(new Set(present)).slice(0, 8),
    missing: Array.from(new Set(missing)).slice(0, 6),
  };
}

/**
 * Computes a deterministic 0–100 On-Page Optimization score for a page + target keyword.
 */
export function computeOnPageScore(params: {
  title: string | null;
  metaDescription: string | null;
  h1: string[] | null;
  headings: Array<{ level: number; text: string }> | null;
  wordCount: number | null;
  schemaTypes: string[] | null;
  inlinks: number;
  targetKeyword: string;
}): number {
  let score = 0;
  const kwLower = params.targetKeyword.toLowerCase();
  const primaryToken = kwLower.split(/\s+/)[0] ?? kwLower;

  // 1. Title tag (25 pts)
  if (params.title) {
    const len = params.title.length;
    score += len >= 30 && len <= 60 ? 15 : 8;
    if (
      params.title.toLowerCase().includes(kwLower) ||
      params.title.toLowerCase().includes(primaryToken)
    ) {
      score += 10;
    }
  }

  // 2. Meta description (15 pts)
  if (params.metaDescription) {
    const len = params.metaDescription.length;
    score += len >= 110 && len <= 165 ? 10 : 5;
    if (params.metaDescription.toLowerCase().includes(primaryToken)) {
      score += 5;
    }
  }

  // 3. Single H1 with target topic (20 pts)
  const h1Count = params.h1?.length ?? 0;
  if (h1Count === 1) {
    score += 12;
    if (params.h1![0]!.toLowerCase().includes(primaryToken)) {
      score += 8;
    }
  } else if (h1Count > 1) {
    score += 6;
  }

  // 4. H2/H3 depth & word count (20 pts)
  const h2Count = (params.headings ?? []).filter((h) => h.level === 2).length;
  if (h2Count >= 3) score += 10;
  else if (h2Count >= 1) score += 5;

  const wc = params.wordCount ?? 0;
  if (wc >= 600) score += 10;
  else if (wc >= 300) score += 6;
  else if (wc >= 150) score += 3;

  // 5. Structured data & internal links (20 pts)
  if ((params.schemaTypes?.length ?? 0) > 0) score += 10;
  if (params.inlinks >= 3) score += 10;
  else if (params.inlinks >= 1) score += 5;

  return Math.max(0, Math.min(100, score));
}

/**
 * Produces a complete On-Page Optimization report for a crawled page (`pages/[pageId]`).
 */
export async function optimizePageById(params: {
  userId: string;
  projectId: string;
  pageId: string;
  targetKeyword?: string;
}): Promise<OnPageOptimizationReport> {
  return withUserDb(params.userId, async (tx) => {
    await assertProjectAccess(tx, params.userId, params.projectId, "viewer");
    const [pageRow] = await tx
      .select()
      .from(pages)
      .where(and(eq(pages.id, params.pageId), eq(pages.projectId, params.projectId)))
      .limit(1);

    if (!pageRow) {
      throw new NotFoundError("Crawled page not found in this project");
    }

    const [projectRow] = await tx
      .select({ name: projects.name, url: projects.url })
      .from(projects)
      .where(eq(projects.id, params.projectId))
      .limit(1);

    // Check top GSC query for this URL if available
    const [topGsc] = await tx
      .select({ query: searchPerformance.query })
      .from(searchPerformance)
      .where(
        and(
          eq(searchPerformance.projectId, params.projectId),
          eq(searchPerformance.page, pageRow.url),
        ),
      )
      .orderBy(desc(searchPerformance.impressions))
      .limit(1);

    const inferred = inferTargetKeyword({
      explicitKeyword: params.targetKeyword,
      topGscQuery: topGsc?.query ?? null,
      h1: pageRow.h1,
      title: pageRow.title,
      url: pageRow.url,
    });

    const intentInfo = classifySearchIntent(inferred.keyword);
    const headings = pageRow.headings ?? [];
    const entities = extractCoreEntities(inferred.keyword, headings, pageRow.summary);

    const onPageScore = computeOnPageScore({
      title: pageRow.title,
      metaDescription: pageRow.metaDescription,
      h1: pageRow.h1,
      headings,
      wordCount: pageRow.wordCount,
      schemaTypes: pageRow.schemaTypes,
      inlinks: pageRow.inlinks,
      targetKeyword: inferred.keyword,
    });

    const intentMatchScore = Math.min(
      100,
      Math.round(
        onPageScore * 0.65 +
          (entities.present.length /
            Math.max(1, entities.present.length + entities.missing.length)) *
            35,
      ),
    );

    const variants = buildTitleMetaVariants({
      targetKeyword: inferred.keyword,
      brandName: projectRow?.name ?? "RankPilot",
      intent: intentInfo.intent,
    });

    // Heading recommendations
    const headingOutlineFixes: HeadingRecommendation[] = [];
    const h1s = pageRow.h1 ?? [];
    const kwTitle = toTitleCase(inferred.keyword);

    if (h1s.length === 0) {
      headingOutlineFixes.push({
        level: "H1",
        action: "add",
        currentText: null,
        suggestedText: `${kwTitle}: Complete Overview & Implementation Guide`,
        reason: "Page is missing an <h1> tag. Every indexable page should have exactly one primary H1.",
      });
    } else if (h1s.length > 1) {
      headingOutlineFixes.push({
        level: "H1",
        action: "rewrite",
        currentText: h1s.join(" | "),
        suggestedText: h1s[0]!,
        reason: `Page has ${h1s.length} H1 tags. Keep a single primary <h1> and demote secondary headings to <h2>.`,
      });
    } else {
      headingOutlineFixes.push({
        level: "H1",
        action: "keep",
        currentText: h1s[0]!,
        suggestedText: h1s[0]!.toLowerCase().includes(inferred.keyword.split(" ")[0] ?? "")
          ? h1s[0]!
          : `${kwTitle} — ${h1s[0]!}`,
        reason: "Single H1 tag is present; ensure the primary keyword entity appears naturally.",
      });
    }

    const h2s = headings.filter((h) => h.level === 2);
    if (h2s.length < 3) {
      headingOutlineFixes.push({
        level: "H2",
        action: "add",
        currentText: null,
        suggestedText: `How ${kwTitle} Works Step-by-Step`,
        reason: "Adding structured H2 subheadings improves topical coverage and passage indexing.",
      });
      headingOutlineFixes.push({
        level: "H2",
        action: "add",
        currentText: null,
        suggestedText: `Common ${kwTitle} Pitfalls & Verification Checklist`,
        reason: "Addresses high-intent comparison and troubleshooting sub-queries.",
      });
    }

    headingOutlineFixes.push({
      level: "H2",
      action: "add",
      currentText: null,
      suggestedText: `Frequently Asked Questions About ${kwTitle}`,
      reason: "Captures People Also Ask (PAA) queries and supports FAQPage / AI Overview citations.",
    });

    // Internal link opportunities: find other crawled pages in the project that do NOT yet link to this page
    const existingIncoming = await tx
      .select({ fromPageId: links.fromPageId })
      .from(links)
      .where(
        and(
          eq(links.projectId, params.projectId),
          eq(links.toPageId, pageRow.id),
        ),
      );
    const alreadyLinkingIds = new Set(existingIncoming.map((r) => r.fromPageId));

    const otherPages = await tx
      .select({
        id: pages.id,
        url: pages.url,
        title: pages.title,
        inlinks: pages.inlinks,
        statusCode: pages.statusCode,
      })
      .from(pages)
      .where(
        and(
          eq(pages.projectId, params.projectId),
          ne(pages.id, pageRow.id),
        ),
      )
      .orderBy(desc(pages.inlinks))
      .limit(30);

    const internalLinkOpportunities: InternalLinkOpportunity[] = otherPages
      .filter((p) => (p.statusCode ?? 200) < 300 && !alreadyLinkingIds.has(p.id))
      .slice(0, 5)
      .map((p) => ({
        sourcePageId: p.id,
        sourceUrl: p.url,
        sourceTitle: p.title,
        sourceInlinks: p.inlinks,
        suggestedAnchorText: inferred.keyword,
        rationale: `High-authority internal page (${p.inlinks} incoming links) that does not yet link to ${pageRow.url}.`,
      }));

    // Suggested FAQs & JSON-LD Schema
    const suggestedFaqs = [
      {
        question: `What is ${inferred.keyword} and why does it matter for SEO?`,
        answer: `${toTitleCase(inferred.keyword)} helps search engines and users understand your page's core topic, improving relevance, click-through rate, and indexation quality.`,
      },
      {
        question: `How do I verify ${inferred.keyword} improvements?`,
        answer: `Audit your title tag, heading hierarchy, internal links, and structured data, then monitor impressions and average position in Google Search Console over 28 days.`,
      },
      {
        question: `How often should ${inferred.keyword} be reviewed?`,
        answer: `Review your page performance and content freshness quarterly or whenever Search Console flags a CTR gap or position drop.`,
      },
    ];

    const recommendedSchemaType: OnPageOptimizationReport["recommendedSchemaType"] =
      intentInfo.intent === "transactional"
        ? "Product"
        : intentInfo.intent === "commercial"
          ? "SoftwareApplication"
          : "Article";

    const schemaGenerated = generateSchemaJsonLd({
      type: "Article",
      headline: clampLength(variants[0]!.title, 105),
      description: variants[0]!.metaDescription,
      url: pageRow.url,
      authorName: projectRow?.name ?? "Editorial Team",
      publisherName: projectRow?.name ?? "RankPilot",
      datePublished: new Date().toISOString().slice(0, 10),
    });

    return {
      pageId: pageRow.id,
      url: pageRow.url,
      targetKeyword: inferred.keyword,
      inferredFrom: inferred.source,
      intent: intentInfo.intent,
      intentConfidence: intentInfo.confidence,
      intentMatchScore,
      intentRationale: intentInfo.rationale,
      onPageScore,
      entitiesPresent: entities.present,
      entitiesMissing: entities.missing,
      variants,
      headingOutlineFixes,
      internalLinkOpportunities,
      suggestedFaqs,
      recommendedSchemaType,
      recommendedSchemaSnippet: schemaGenerated.scriptTagSnippet,
      evaluatedAt: new Date().toISOString(),
    };
  });
}
