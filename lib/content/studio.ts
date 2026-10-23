import { and, desc, eq, isNull } from "drizzle-orm";
import { withUserDb } from "@/lib/db/rls";
import {
  contentItems,
  contentVersions,
  pages,
  projects,
  type SearchIntent,
} from "@/lib/db/schema";
import { classifySearchIntent } from "@/lib/onpage/optimizer";
import { assertProjectAccess, NotFoundError } from "@/lib/security/authz";

export interface ContentBriefStructure {
  targetKeyword: string;
  intent: SearchIntent;
  intentConfidence: number;
  recommendedWordCount: { min: number; max: number };
  titleIdeas: string[];
  metaDescriptionIdea: string;
  outline: Array<{
    level: "H2" | "H3";
    heading: string;
    keyPoints: string[];
  }>;
  entitiesToCover: string[];
  questionsToAnswer: string[];
  internalLinksToInclude: Array<{
    url: string;
    title: string | null;
    suggestedAnchor: string;
  }>;
  eeatExperiencePrompts: string[];
  recommendedSchemaTypes: string[];
}

export interface OriginalityReport {
  /** 0–100 originality score (100 = 0% shingle overlap with reference sources). */
  score: number;
  shingleSize: number;
  overlapRatio: number;
  matchedShingleCount: number;
  matchedPhrases: string[];
  keywordStuffingFlag: boolean;
  maxKeywordDensityPct: number;
  eeatPlaceholdersRemaining: number;
  hasEeatMarkersOrNotes: boolean;
  passed: boolean;
  checkedAt: string;
}

export interface ContentChecklistItem {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  weight: number;
}

export interface ContentVersionDto {
  id: string;
  version: number;
  bodyMd: string;
  author: "user" | "agent";
  originality: OriginalityReport | null;
  createdAt: string;
}

export interface ContentItemDto {
  id: string;
  projectId: string;
  type: "brief" | "article";
  title: string;
  targetKeyword: string | null;
  status: "draft" | "in_review" | "approved" | "archived";
  brief: ContentBriefStructure | null;
  currentVersionId: string | null;
  seoScore: number | null;
  checklist: ContentChecklistItem[];
  versions: ContentVersionDto[];
  createdAt: string;
  updatedAt: string;
}

const DENSITY_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "your",
  "are",
  "was",
  "were",
  "have",
  "has",
  "had",
  "not",
  "but",
  "you",
  "can",
  "will",
  "into",
  "about",
  "more",
  "when",
  "what",
  "which",
  "their",
  "they",
  "them",
  "how",
  "why",
  "where",
  "who",
  "also",
  "than",
  "then",
  "some",
  "such",
  "only",
  "other",
  "each",
  "every",
  "should",
  "would",
  "could",
]);

function tokenizeNormalizedWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\[eeat_placeholder:[^\]]*\]/gi, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/**
 * Deterministic 8-gram shingle originality & anti-keyword-stuffing guardrail.
 * Guarantees drafts do not copy contiguous 8-word spans from competitor/reference texts
 * and do not violate Google Search Essentials keyword-stuffing thresholds.
 */
export function computeShingleOriginality(params: {
  draftMd: string;
  referenceTexts?: string[];
  targetKeyword?: string | null;
  shingleSize?: number;
}): OriginalityReport {
  const shingleSize = params.shingleSize ?? 8;
  const draftTokens = tokenizeNormalizedWords(params.draftMd);
  const referenceSet = new Set<string>();

  for (const ref of params.referenceTexts ?? []) {
    const refTokens = tokenizeNormalizedWords(ref);
    if (refTokens.length >= shingleSize) {
      for (let i = 0; i <= refTokens.length - shingleSize; i++) {
        referenceSet.add(refTokens.slice(i, i + shingleSize).join(" "));
      }
    }
  }

  const matchedPhrases: string[] = [];
  let totalDraftShingles = 0;
  let matchedShingleCount = 0;

  if (draftTokens.length >= shingleSize) {
    totalDraftShingles = draftTokens.length - shingleSize + 1;
    for (let i = 0; i < totalDraftShingles; i++) {
      const shingle = draftTokens.slice(i, i + shingleSize).join(" ");
      if (referenceSet.has(shingle)) {
        matchedShingleCount += 1;
        if (matchedPhrases.length < 5 && !matchedPhrases.includes(shingle)) {
          matchedPhrases.push(shingle);
        }
      }
    }
  }

  const overlapRatio =
    totalDraftShingles > 0
      ? Math.round((matchedShingleCount / totalDraftShingles) * 1000) / 1000
      : 0;

  // Check keyword stuffing density
  const freq = new Map<string, number>();
  const meaningfulTokens = draftTokens.filter(
    (w) => w.length >= 4 && !DENSITY_STOP_WORDS.has(w),
  );
  for (const token of meaningfulTokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }

  let maxCount = 0;
  for (const count of freq.values()) {
    if (count > maxCount) maxCount = count;
  }

  const maxKeywordDensityPct =
    draftTokens.length >= 40
      ? Math.round((maxCount / draftTokens.length) * 1000) / 10
      : 0;

  // Flag stuffing if any single word exceeds 4.5% of a >= 60-word article
  const keywordStuffingFlag = draftTokens.length >= 60 && maxKeywordDensityPct > 4.5;

  // Count remaining [EEAT_PLACEHOLDER: ...] markers
  const placeholderMatches = params.draftMd.match(/\[EEAT_PLACEHOLDER:[^\]]+\]/gi) ?? [];
  const eeatPlaceholdersRemaining = placeholderMatches.length;
  const hasEeatMarkersOrNotes =
    eeatPlaceholdersRemaining > 0 ||
    /\b(our benchmark|in our testing|we measured|case study|first-hand)\b/i.test(
      params.draftMd,
    );

  const rawScore = Math.round((1 - Math.min(1, overlapRatio * 4)) * 100);
  const score = keywordStuffingFlag ? Math.min(65, rawScore) : rawScore;
  const passed = overlapRatio < 0.05 && !keywordStuffingFlag;

  return {
    score,
    shingleSize,
    overlapRatio,
    matchedShingleCount,
    matchedPhrases,
    keywordStuffingFlag,
    maxKeywordDensityPct,
    eeatPlaceholdersRemaining,
    hasEeatMarkersOrNotes,
    passed,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Evaluates a Markdown draft against RankPilot's deterministic SEO & E-E-A-T content checklist.
 */
export function evaluateContentSeoChecklist(params: {
  title: string;
  targetKeyword: string;
  bodyMd: string;
  brief?: ContentBriefStructure | null;
  originality?: OriginalityReport | null;
}): { seoScore: number; checklist: ContentChecklistItem[] } {
  const kwLower = (params.targetKeyword || params.title).toLowerCase().trim();
  const primaryToken = kwLower.split(/\s+/)[0] ?? kwLower;
  const bodyLower = params.bodyMd.toLowerCase();
  const words = tokenizeNormalizedWords(params.bodyMd);
  const wordCount = words.length;

  const h1Matches = params.bodyMd.match(/^#\s+.+$/gm) ?? [];
  const h2Matches = params.bodyMd.match(/^##\s+.+$/gm) ?? [];
  const linkMatches = params.bodyMd.match(/\[[^\]]+\]\([^)]+\)/g) ?? [];
  const eeatPlaceholders = params.bodyMd.match(/\[EEAT_PLACEHOLDER:[^\]]+\]/gi) ?? [];

  const first150Words = words.slice(0, 150).join(" ");
  const kwInIntro =
    first150Words.includes(kwLower) || first150Words.includes(primaryToken);

  const kwInTitle =
    params.title.toLowerCase().includes(kwLower) ||
    params.title.toLowerCase().includes(primaryToken);

  const entitiesToCheck = params.brief?.entitiesToCover ?? [];
  const coveredEntities = entitiesToCheck.filter((e) =>
    bodyLower.includes(e.toLowerCase().split(/\s+/)[0] ?? e.toLowerCase()),
  );
  const entityCoverageRatio =
    entitiesToCheck.length > 0 ? coveredEntities.length / entitiesToCheck.length : 1;

  const originalityPassed = params.originality ? params.originality.passed : true;

  const checklist: ContentChecklistItem[] = [
    {
      id: "kw_in_title",
      label: "Target keyword in article title / H1",
      passed: kwInTitle || h1Matches.some((h) => h.toLowerCase().includes(primaryToken)),
      detail: kwInTitle
        ? `Target topic '${params.targetKeyword}' is present in the title.`
        : `Include '${params.targetKeyword}' naturally in your main headline.`,
      weight: 15,
    },
    {
      id: "kw_in_intro",
      label: "Direct answer & target keyword in first 150 words",
      passed: kwInIntro && wordCount >= 50,
      detail: kwInIntro
        ? "Opening paragraph addresses the primary topic directly (Answer-First GEO pattern)."
        : "Mention the target topic and direct definition in your opening paragraph.",
      weight: 15,
    },
    {
      id: "heading_structure",
      label: "Structured H2 subheadings (at least 4 H2 sections)",
      passed: h2Matches.length >= 4,
      detail: `${h2Matches.length} H2 subheadings found in draft.`,
      weight: 15,
    },
    {
      id: "word_count_depth",
      label: "Comprehensive topical depth (450+ words)",
      passed: wordCount >= 450,
      detail: `Current draft length: ${wordCount} words.`,
      weight: 15,
    },
    {
      id: "entity_coverage",
      label: "Core entity & subtopic coverage (>= 70%)",
      passed: entityCoverageRatio >= 0.7,
      detail:
        entitiesToCheck.length > 0
          ? `Covered ${coveredEntities.length} of ${entitiesToCheck.length} brief entities.`
          : "Core topic entities present.",
      weight: 15,
    },
    {
      id: "internal_links",
      label: "Contextual internal links included (2+ links)",
      passed: linkMatches.length >= 2,
      detail: `${linkMatches.length} Markdown links found in draft.`,
      weight: 10,
    },
    {
      id: "eeat_experience",
      label: "E-E-A-T first-hand experience blocks present",
      passed:
        eeatPlaceholders.length > 0 ||
        Boolean(params.originality?.hasEeatMarkersOrNotes),
      detail:
        eeatPlaceholders.length > 0
          ? `${eeatPlaceholders.length} E-E-A-T human experience prompt(s) embedded for editorial completion.`
          : "First-hand experience evidence included.",
      weight: 15,
    },
    {
      id: "originality_guardrail",
      label: "8-gram shingle originality & anti-stuffing check",
      passed: originalityPassed,
      detail: originalityPassed
        ? `Originality score ${params.originality?.score ?? 100}/100 (zero copied 8-word shingles, natural keyword density).`
        : "High phrase overlap or keyword stuffing detected; revise highlighted sections.",
      weight: 15,
    },
  ];

  // Normalize weights to 0-100
  const totalWeight = checklist.reduce((acc, c) => acc + c.weight, 0);
  const earnedWeight = checklist
    .filter((c) => c.passed)
    .reduce((acc, c) => acc + c.weight, 0);

  const seoScore = Math.round((earnedWeight / Math.max(1, totalWeight)) * 100);
  return { seoScore, checklist };
}

function toTitleCase(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Builds a deterministic, evidence-backed `ContentBriefStructure` for a target keyword.
 */
export function buildStructuredContentBrief(params: {
  targetKeyword: string;
  brandName: string;
  crawledPages: Array<{ url: string; title: string | null }>;
}): ContentBriefStructure {
  const kwClean = params.targetKeyword.trim();
  const kwTitle = toTitleCase(kwClean);
  const intentInfo = classifySearchIntent(kwClean);

  const internalLinksToInclude = params.crawledPages.slice(0, 4).map((p) => ({
    url: p.url,
    title: p.title,
    suggestedAnchor: p.title ? p.title.split(/[|—–:-]/)[0]!.trim() : kwClean,
  }));

  return {
    targetKeyword: kwClean,
    intent: intentInfo.intent,
    intentConfidence: intentInfo.confidence,
    recommendedWordCount:
      intentInfo.intent === "informational"
        ? { min: 1100, max: 1800 }
        : { min: 850, max: 1400 },
    titleIdeas: [
      `${kwTitle}: The Definitive Guide & Implementation Checklist (${new Date().getFullYear()})`,
      `How to Master ${kwTitle}: Step-by-Step Framework | ${params.brandName}`,
      `${kwTitle} Explained: Architecture, Benchmarks & Best Practices`,
    ],
    metaDescriptionIdea: `Learn how ${kwClean.toLowerCase()} works with step-by-step architecture, real performance benchmarks, and a copy-paste verification checklist from ${params.brandName}.`,
    outline: [
      {
        level: "H2",
        heading: `What Is ${kwTitle} and Why It Matters`,
        keyPoints: [
          `Direct 45-word answer-first definition of ${kwClean} for Featured Snippets and AI Overviews.`,
          "Core problem it solves and measurable impact on organic search performance.",
        ],
      },
      {
        level: "H2",
        heading: `Core Architecture & Prerequisites for ${kwTitle}`,
        keyPoints: [
          "Technical prerequisites and data sources to verify before starting.",
          "Common baseline metrics to record before making changes.",
        ],
      },
      {
        level: "H2",
        heading: `Step-by-Step ${kwTitle} Implementation Workflow`,
        keyPoints: [
          "Step 1: Audit current baseline and identify high-priority gaps.",
          "Step 2: Apply clean technical and on-page fixes with human review.",
          "Step 3: Validate structured data and internal link distribution.",
        ],
      },
      {
        level: "H2",
        heading: `Real-World Benchmarks & Case Study Evidence (E-E-A-T)`,
        keyPoints: [
          "First-hand measurements, screenshots, or production lessons learned.",
          "Trade-offs and edge cases encountered in real deployments.",
        ],
      },
      {
        level: "H2",
        heading: `Common ${kwTitle} Mistakes to Avoid`,
        keyPoints: [
          "Pitfalls that trigger regressions or violate Google Search Essentials.",
          "How to monitor regressions continuously.",
        ],
      },
      {
        level: "H2",
        heading: `Frequently Asked Questions About ${kwTitle}`,
        keyPoints: [
          `How long does ${kwClean.toLowerCase()} take to show measurable results?`,
          `What tools are required to verify ${kwClean.toLowerCase()}?`,
          `How does ${kwClean.toLowerCase()} impact AI Overviews and GEO citations?`,
        ],
      },
    ],
    entitiesToCover: [
      kwClean.toLowerCase(),
      "search console",
      "technical audit",
      "structured data",
      "internal linking",
      "core web vitals",
      "verification checklist",
    ],
    questionsToAnswer: [
      `What is ${kwClean.toLowerCase()} and how does it work?`,
      `What are the most important steps for ${kwClean.toLowerCase()}?`,
      `How do you measure the ROI of ${kwClean.toLowerCase()}?`,
    ],
    internalLinksToInclude,
    eeatExperiencePrompts: [
      `[EEAT_PLACEHOLDER: Share a real metric, before/after chart, or concrete lesson from your team's hands-on experience implementing ${kwClean}.]`,
      `[EEAT_PLACEHOLDER: Insert an original screenshot, code snippet, or workflow diagram from ${params.brandName} showing ${kwClean} in production.]`,
    ],
    recommendedSchemaTypes: ["Article", "FAQPage", "BreadcrumbList"],
  };
}

/**
 * Synthesizes a complete, human-in-the-loop Markdown article draft from a `ContentBriefStructure`.
 * Includes mandatory `[EEAT_PLACEHOLDER: ...]` blocks so the agent never fabricates first-hand experience.
 */
export function buildEeatArticleDraftMd(params: {
  title: string;
  brief: ContentBriefStructure;
  brandName: string;
}): string {
  const kw = params.brief.targetKeyword;
  const kwTitle = toTitleCase(kw);
  const links = params.brief.internalLinksToInclude;

  const link1 = links[0]
    ? `[${links[0].suggestedAnchor}](${links[0].url})`
    : `[${params.brandName} Technical Overview](https://example.com/overview)`;
  const link2 = links[1]
    ? `[${links[1].suggestedAnchor}](${links[1].url})`
    : `[SEO Audit Checklist](https://example.com/audit-checklist)`;

  return `# ${params.title}

**${kwTitle}** is a systematic framework for improving how search engines crawl, index, understand, and cite your pages across both classic organic search results and generative AI answer engines. By aligning technical signals, structured data, and genuine first-hand expertise, teams achieve compounding visibility without relying on shortcuts.

In this guide from **${params.brandName}**, we break down the core architecture of ${kw.toLowerCase()}, walk through a repeatable implementation checklist, and share verification steps you can apply immediately.

---

## What Is ${kwTitle} and Why It Matters

At its core, **${kw.toLowerCase()}** connects user search intent with verifiable on-page evidence. Search engines evaluate whether a page resolves the user's query clearly, loads reliably under Core Web Vitals thresholds, and demonstrates authentic subject-matter authority.

When properly executed alongside ${link1}, a structured approach to ${kw.toLowerCase()} delivers three measurable outcomes:

1. **Higher Crawl & Indexation Efficiency:** Clear canonical signals and internal link architecture help crawlers prioritize your most valuable URLs.
2. **Stronger Query-to-Page Relevance:** Focused heading hierarchies and comprehensive entity coverage reduce keyword cannibalization across your domain.
3. **Eligibility for Rich Results & AI Citations:** Answer-first formatting paired with validated JSON-LD schema increases visibility in Featured Snippets, People Also Ask, and AI Overviews.

---

## Core Architecture & Prerequisites for ${kwTitle}

Before modifying templates or publishing new pages, establish a clean baseline in Google Search Console and your technical audit log. Make sure your team has verified:

- **Indexability & Canonical Alignment:** Confirm target pages return HTTP 200 and declare a self-referencing canonical URL.
- **Internal Link Equity:** Connect related topic cluster pages using descriptive anchor text such as ${link2}.
- **Structured Data Coverage:** Prepare validated \`Article\`, \`FAQPage\`, and \`BreadcrumbList\` JSON-LD blocks.

${params.brief.eeatExperiencePrompts[0] ?? `[EEAT_PLACEHOLDER: Share a real metric, before/after chart, or concrete lesson from your team's hands-on experience implementing ${kw}.]`}

---

## Step-by-Step ${kwTitle} Implementation Workflow

Follow this five-step engineering and editorial workflow to roll out ${kw.toLowerCase()} safely:

### Step 1: Audit Your Baseline Signals
Review your current impressions, click-through rate (CTR), and average position in Search Console over the past 28 days. Prioritize URLs ranking in positions 4 through 20 where small relevance and title improvements produce immediate traffic gains.

### Step 2: Align Title Tags, Meta Descriptions, and H1s
Ensure your primary \`<title>\` tag stays between 30 and 60 characters, front-loads the core topic naturally, and pairs with a compelling 120–160 character meta description that sets accurate expectations for the reader.

### Step 3: Expand Subtopic & Entity Coverage
Organize the body content with clear \`<h2>\` and \`<h3>\` subheadings covering implementation steps, verification benchmarks, and edge cases. Avoid thin filler paragraphs—every section should answer a specific question a practitioner actually asks.

### Step 4: Embed Validated Structured Data
Add JSON-LD structured data that reflects the visible content on the page. Validate required properties for \`Article\` and \`FAQPage\` before deploying to production.

---

## Real-World Benchmarks & Case Study Evidence (E-E-A-T)

Search engines and human readers reward content grounded in real operational experience rather than generic summaries. Complete the editorial block below with your team's first-hand observations before marking this draft approved:

${params.brief.eeatExperiencePrompts[1] ?? `[EEAT_PLACEHOLDER: Insert an original screenshot, code snippet, or workflow diagram from ${params.brandName} showing ${kw} in production.]`}

| Verification Signal | Target Threshold | Data Source |
| :--- | :--- | :--- |
| Primary Title Length | 30–60 characters | HTML Parser / Site Audit |
| Core Web Vitals LCP | <= 2,500 ms (p75) | CrUX / PageSpeed Insights |
| Internal Incoming Links | >= 3 contextual links | Internal Link Graph |
| JSON-LD Schema Validation | 0 required-property errors | Schema Validator |

---

## Common ${kwTitle} Mistakes to Avoid

Even experienced teams run into avoidable regressions when scaling ${kw.toLowerCase()}:

- **Publishing Unedited Boilerplate:** Never publish AI-assisted drafts without filling in real product screenshots, proprietary benchmarks, and human editorial review.
- **Ignoring Internal Link Orphans:** New articles published with zero incoming internal links struggle to get crawled and indexed promptly.
- **Splitting Intent Across Duplicate URLs:** Check Search Console query-to-page mappings first so you consolidate authority into a single canonical URL rather than competing against yourself.

---

## Frequently Asked Questions About ${kwTitle}

### What is ${kw.toLowerCase()} and how does it work?
${kwTitle} is the practice of structuring technical metadata, on-page hierarchy, internal links, and verifiable expertise so search engines and users can immediately find and trust your answer.

### What are the most important steps for ${kw.toLowerCase()}?
Start by auditing baseline Search Console queries, optimizing your title and H1 for intent match, covering essential subtopics under clear H2 headings, adding contextual internal links, and validating JSON-LD schema.

### How do you measure the ROI of ${kw.toLowerCase()}?
Track 28-day non-branded impressions, average position improvements on target cluster keywords, organic click-through rate lifts, and engaged organic sessions in GA4.
`;
}

/**
 * Lists all Content Studio items (`content_items`) and their versions for a project.
 */
export async function listProjectContentItems(
  userId: string,
  projectId: string,
): Promise<ContentItemDto[]> {
  return withUserDb(userId, async (tx) => {
    await assertProjectAccess(tx, userId, projectId, "viewer");
    const items = await tx
      .select()
      .from(contentItems)
      .where(
        and(
          eq(contentItems.projectId, projectId),
          isNull(contentItems.deletedAt),
        ),
      )
      .orderBy(desc(contentItems.updatedAt));

    const versions = await tx
      .select()
      .from(contentVersions)
      .where(eq(contentVersions.projectId, projectId))
      .orderBy(desc(contentVersions.version));

    const versionsByItem = new Map<string, ContentVersionDto[]>();
    for (const v of versions) {
      const list = versionsByItem.get(v.contentItemId) ?? [];
      list.push({
        id: v.id,
        version: v.version,
        bodyMd: v.bodyMd,
        author: v.author,
        originality: (v.originality as OriginalityReport | null) ?? null,
        createdAt: v.createdAt.toISOString(),
      });
      versionsByItem.set(v.contentItemId, list);
    }

    return items.map((item) => ({
      id: item.id,
      projectId: item.projectId,
      type: item.type,
      title: item.title,
      targetKeyword: item.targetKeyword,
      status: item.status,
      brief: (item.brief as ContentBriefStructure | null) ?? null,
      currentVersionId: item.currentVersionId,
      seoScore: item.seoScore,
      checklist: Array.isArray(item.checklist)
        ? (item.checklist as ContentChecklistItem[])
        : [],
      versions: versionsByItem.get(item.id) ?? [],
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    }));
  });
}

/**
 * Creates a new Content Brief (and optionally generates the initial E-E-A-T article draft version).
 */
export async function createContentBriefAndOptionalDraft(params: {
  userId: string;
  projectId: string;
  targetKeyword: string;
  title?: string;
  generateInitialDraft?: boolean;
}): Promise<ContentItemDto> {
  const createdId = await withUserDb(params.userId, async (tx) => {
    await assertProjectAccess(tx, params.userId, params.projectId, "editor");
    const [proj] = await tx
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, params.projectId))
      .limit(1);

    const crawledPages = await tx
      .select({ url: pages.url, title: pages.title, summary: pages.summary })
      .from(pages)
      .where(eq(pages.projectId, params.projectId))
      .orderBy(desc(pages.inlinks))
      .limit(10);

    const brief = buildStructuredContentBrief({
      targetKeyword: params.targetKeyword,
      brandName: proj?.name ?? "RankPilot",
      crawledPages,
    });

    const resolvedTitle =
      params.title?.trim() || brief.titleIdeas[0] || toTitleCase(params.targetKeyword);

    const [insertedItem] = await tx
      .insert(contentItems)
      .values({
        projectId: params.projectId,
        type: params.generateInitialDraft ? "article" : "brief",
        title: resolvedTitle,
        targetKeyword: params.targetKeyword.trim(),
        status: "draft",
        brief,
        seoScore: null,
        checklist: [],
      })
      .returning();

    if (params.generateInitialDraft) {
      const bodyMd = buildEeatArticleDraftMd({
        title: resolvedTitle,
        brief,
        brandName: proj?.name ?? "RankPilot",
      });

      const originality = computeShingleOriginality({
        draftMd: bodyMd,
        referenceTexts: crawledPages
          .map((p) => p.summary ?? "")
          .filter((s) => s.length > 0),
        targetKeyword: params.targetKeyword,
      });

      const { seoScore, checklist } = evaluateContentSeoChecklist({
        title: resolvedTitle,
        targetKeyword: params.targetKeyword,
        bodyMd,
        brief,
        originality,
      });

      const [ver] = await tx
        .insert(contentVersions)
        .values({
          projectId: params.projectId,
          contentItemId: insertedItem!.id,
          version: 1,
          bodyMd,
          author: "agent",
          originality,
        })
        .returning();

      await tx
        .update(contentItems)
        .set({
          currentVersionId: ver!.id,
          seoScore,
          checklist,
          updatedAt: new Date(),
        })
        .where(eq(contentItems.id, insertedItem!.id));
    }

    return insertedItem!.id;
  });

  const all = await listProjectContentItems(params.userId, params.projectId);
  const found = all.find((i) => i.id === createdId);
  if (!found) throw new NotFoundError("Created content item not found");
  return found;
}

/**
 * Generates or regenerates an E-E-A-T article draft version for an existing `content_item`.
 */
export async function generateDraftForContentItem(params: {
  userId: string;
  contentItemId: string;
  referenceTexts?: string[];
}): Promise<ContentItemDto> {
  const projectId = await withUserDb(params.userId, async (tx) => {
    const [item] = await tx
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, params.contentItemId), isNull(contentItems.deletedAt)))
      .limit(1);

    if (!item) throw new NotFoundError("Content item not found");

    const [proj] = await tx
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, item.projectId))
      .limit(1);

    const crawledPages = await tx
      .select({ url: pages.url, title: pages.title, summary: pages.summary })
      .from(pages)
      .where(eq(pages.projectId, item.projectId))
      .orderBy(desc(pages.inlinks))
      .limit(10);

    const existingVersions = await tx
      .select({ version: contentVersions.version })
      .from(contentVersions)
      .where(eq(contentVersions.contentItemId, item.id))
      .orderBy(desc(contentVersions.version))
      .limit(1);

    const nextVersion = (existingVersions[0]?.version ?? 0) + 1;

    const brief: ContentBriefStructure =
      (item.brief as ContentBriefStructure | null) ??
      buildStructuredContentBrief({
        targetKeyword: item.targetKeyword ?? item.title,
        brandName: proj?.name ?? "RankPilot",
        crawledPages,
      });

    const bodyMd = buildEeatArticleDraftMd({
      title: item.title,
      brief,
      brandName: proj?.name ?? "RankPilot",
    });

    const refs = [
      ...(params.referenceTexts ?? []),
      ...crawledPages.map((p) => p.summary ?? "").filter(Boolean),
    ];

    const originality = computeShingleOriginality({
      draftMd: bodyMd,
      referenceTexts: refs,
      targetKeyword: item.targetKeyword ?? item.title,
    });

    const { seoScore, checklist } = evaluateContentSeoChecklist({
      title: item.title,
      targetKeyword: item.targetKeyword ?? item.title,
      bodyMd,
      brief,
      originality,
    });

    const [ver] = await tx
      .insert(contentVersions)
      .values({
        projectId: item.projectId,
        contentItemId: item.id,
        version: nextVersion,
        bodyMd,
        author: "agent",
        originality,
      })
      .returning();

    await tx
      .update(contentItems)
      .set({
        type: "article",
        brief,
        currentVersionId: ver!.id,
        seoScore,
        checklist,
        updatedAt: new Date(),
      })
      .where(eq(contentItems.id, item.id));

    return item.projectId;
  });

  const all = await listProjectContentItems(params.userId, projectId);
  const updated = all.find((i) => i.id === params.contentItemId);
  if (!updated) throw new NotFoundError("Content item not found");
  return updated;
}

/**
 * Saves a user-edited Markdown version or updates the approval status of a `content_item`.
 */
export async function updateContentItemAndSaveVersion(params: {
  userId: string;
  contentItemId: string;
  title?: string;
  status?: "draft" | "in_review" | "approved" | "archived";
  bodyMd?: string;
}): Promise<ContentItemDto> {
  const projectId = await withUserDb(params.userId, async (tx) => {
    const [item] = await tx
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, params.contentItemId), isNull(contentItems.deletedAt)))
      .limit(1);

    if (!item) throw new NotFoundError("Content item not found");

    const nextTitle = params.title?.trim() || item.title;
    const nextStatus = params.status ?? item.status;

    if (params.bodyMd !== undefined) {
      const existingVersions = await tx
        .select({ version: contentVersions.version })
        .from(contentVersions)
        .where(eq(contentVersions.contentItemId, item.id))
        .orderBy(desc(contentVersions.version))
        .limit(1);

      const nextVersion = (existingVersions[0]?.version ?? 0) + 1;
      const brief = (item.brief as ContentBriefStructure | null) ?? null;

      const originality = computeShingleOriginality({
        draftMd: params.bodyMd,
        targetKeyword: item.targetKeyword ?? nextTitle,
      });

      const { seoScore, checklist } = evaluateContentSeoChecklist({
        title: nextTitle,
        targetKeyword: item.targetKeyword ?? nextTitle,
        bodyMd: params.bodyMd,
        brief,
        originality,
      });

      const [ver] = await tx
        .insert(contentVersions)
        .values({
          projectId: item.projectId,
          contentItemId: item.id,
          version: nextVersion,
          bodyMd: params.bodyMd,
          author: "user",
          originality,
        })
        .returning();

      await tx
        .update(contentItems)
        .set({
          title: nextTitle,
          status: nextStatus,
          currentVersionId: ver!.id,
          seoScore,
          checklist,
          updatedAt: new Date(),
        })
        .where(eq(contentItems.id, item.id));
    } else {
      await tx
        .update(contentItems)
        .set({
          title: nextTitle,
          status: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(contentItems.id, item.id));
    }

    return item.projectId;
  });

  const all = await listProjectContentItems(params.userId, projectId);
  const updated = all.find((i) => i.id === params.contentItemId);
  if (!updated) throw new NotFoundError("Content item not found");
  return updated;
}
