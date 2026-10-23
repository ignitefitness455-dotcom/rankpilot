import { describe, expect, it } from "vitest";
import {
  buildEeatArticleDraftMd,
  buildStructuredContentBrief,
  computeShingleOriginality,
  evaluateContentSeoChecklist,
} from "@/lib/content/studio";
import {
  computeKeywordPriority,
  deriveClusterTopicKey,
  estimateKeywordDifficulty,
  expandSeedKeywords,
} from "@/lib/keywords/service";
import {
  buildTitleMetaVariants,
  classifySearchIntent,
  computeOnPageScore,
  inferTargetKeyword,
} from "@/lib/onpage/optimizer";

describe("Phase 4: Content Studio Originality, On-Page Optimizer & Keyword Clustering", () => {
  it("passes 8-gram shingle originality on clean E-E-A-T drafts and catches copied 8-word spans", () => {
    const brief = buildStructuredContentBrief({
      targetKeyword: "technical seo audit checklist",
      brandName: "RankPilot",
      crawledPages: [
        {
          url: "https://rankpilot.example.com/features",
          title: "RankPilot Features | Autonomous SEO",
        },
      ],
    });

    const draftMd = buildEeatArticleDraftMd({
      title: brief.titleIdeas[0]!,
      brief,
      brandName: "RankPilot",
    });

    // Must contain mandatory E-E-A-T human experience placeholders
    expect(draftMd).toContain("[EEAT_PLACEHOLDER:");

    const cleanCheck = computeShingleOriginality({
      draftMd,
      referenceTexts: [
        "Completely unrelated competitor article discussing paid social media advertising budgets in 2026.",
      ],
      targetKeyword: "technical seo audit checklist",
    });

    expect(cleanCheck.passed).toBe(true);
    expect(cleanCheck.score).toBe(100);
    expect(cleanCheck.overlapRatio).toBe(0);
    expect(cleanCheck.eeatPlaceholdersRemaining).toBeGreaterThanOrEqual(2);

    // Now test against a competitor source that shares verbatim 8-word sequences
    const copiedCompetitorText =
      "At its core technical seo audit checklist connects user search intent with verifiable on page evidence and search engines evaluate whether a page resolves the query clearly.";
    const plagiarizedDraft = `${copiedCompetitorText} ${copiedCompetitorText} ${copiedCompetitorText}`;

    const plagiarizedCheck = computeShingleOriginality({
      draftMd: plagiarizedDraft,
      referenceTexts: [copiedCompetitorText],
    });

    expect(plagiarizedCheck.passed).toBe(false);
    expect(plagiarizedCheck.matchedShingleCount).toBeGreaterThan(0);
    expect(plagiarizedCheck.matchedPhrases.length).toBeGreaterThan(0);

    // Evaluate live SEO checklist on the clean draft
    const checklistEval = evaluateContentSeoChecklist({
      title: brief.titleIdeas[0]!,
      targetKeyword: "technical seo audit checklist",
      bodyMd: draftMd,
      brief,
      originality: cleanCheck,
    });
    expect(checklistEval.seoScore).toBeGreaterThanOrEqual(80);
    expect(checklistEval.checklist).toHaveLength(8);
  });

  it("flags keyword stuffing when a single term exceeds 4.5% density", () => {
    const stuffedWords = Array.from({ length: 80 }, (_, idx) =>
      idx % 4 === 0 ? "backlinks" : `uniqueWord${idx}`,
    ).join(" ");

    const check = computeShingleOriginality({
      draftMd: stuffedWords,
      referenceTexts: [],
    });

    expect(check.keywordStuffingFlag).toBe(true);
    expect(check.passed).toBe(false);
  });

  it("generates 3 on-page title & meta variants within optimal character and pixel bounds", () => {
    const inferred = inferTargetKeyword({
      topGscQuery: "core web vitals optimization",
      url: "https://rankpilot.example.com/blog/cwv",
    });
    expect(inferred.keyword).toBe("core web vitals optimization");
    expect(inferred.source).toBe("gsc_top_query");

    const intent = classifySearchIntent("best seo audit software vs ahrefs");
    expect(intent.intent).toBe("commercial");

    const variants = buildTitleMetaVariants({
      targetKeyword: "core web vitals optimization",
      brandName: "RankPilot",
      intent: "informational",
    });

    expect(variants).toHaveLength(3);
    for (const v of variants) {
      expect(v.titleChars).toBeGreaterThanOrEqual(30);
      expect(v.titleChars).toBeLessThanOrEqual(60);
      expect(v.titleStatus).toBe("optimal");
      expect(v.metaChars).toBeGreaterThanOrEqual(120);
      expect(v.metaChars).toBeLessThanOrEqual(160);
      expect(v.metaStatus).toBe("optimal");
    }

    const score = computeOnPageScore({
      title: variants[0]!.title,
      metaDescription: variants[0]!.metaDescription,
      h1: ["Core Web Vitals Optimization Guide"],
      headings: [
        { level: 2, text: "What Is Core Web Vitals Optimization" },
        { level: 2, text: "Step-by-Step LCP & INP Fixes" },
        { level: 2, text: "Frequently Asked Questions" },
      ],
      wordCount: 950,
      schemaTypes: ["Article", "FAQPage"],
      inlinks: 5,
      targetKeyword: "core web vitals optimization",
    });
    expect(score).toBe(100);
  });

  it("expands seed keywords, groups into topic clusters, and boosts striking-distance GSC positions (4-20)", () => {
    const expanded = expandSeedKeywords(["nextjs seo"]);
    expect(expanded.length).toBeGreaterThanOrEqual(4);
    expect(expanded.some((e) => e.keyword.includes("how to nextjs seo"))).toBe(true);

    const cluster = deriveClusterTopicKey("how to nextjs seo checklist");
    expect(cluster.displayName).toBe("Nextjs Seo Cluster");

    const diff = estimateKeywordDifficulty({
      keyword: "how to fix canonical tags in nextjs",
      intent: "informational",
      gscPosition: 8.4,
    });
    expect(diff.difficultyEst).toBeLessThan(50);
    expect(diff.difficultyConfidence).toBe(0.68);

    const quickWinPriority = computeKeywordPriority({
      intent: "commercial",
      difficultyEst: 35,
      gscImpressions28d: 600,
      gscPosition: 7.2,
      volume: null,
    });
    const unrankedPriority = computeKeywordPriority({
      intent: "commercial",
      difficultyEst: 35,
      gscImpressions28d: null,
      gscPosition: null,
      volume: null,
    });
    expect(quickWinPriority).toBeGreaterThan(unrankedPriority);
  });
});
