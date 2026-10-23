import { describe, expect, it } from "vitest";
import {
  computeApprovalPayloadHash,
  formatTasksExportBundle,
  type TaskItemDto,
} from "@/lib/actions/service";
import {
  computePageCitationReadiness,
  evaluateRobotsAiBotAccess,
  generateLlmsTxtMarkdown,
} from "@/lib/geo/service";
import { renderExecutiveReportHtml } from "@/lib/reports/service";

describe("Phase 5: AI Search (GEO), Action Center Approval Gate & Bilingual Reports", () => {
  it("evaluates robots.txt rules for all 5 AI search bots accurately", () => {
    const robotsTxt = [
      "User-agent: *",
      "Allow: /",
      "",
      "User-agent: GPTBot",
      "Disallow: /",
      "",
      "User-agent: OAI-SearchBot",
      "Allow: /",
    ].join("\n");

    const status = evaluateRobotsAiBotAccess(robotsTxt);
    expect(status).toHaveLength(5);

    const gptBot = status.find((b) => b.bot === "GPTBot");
    const oaiSearch = status.find((b) => b.bot === "OAI-SearchBot");
    const perplexity = status.find((b) => b.bot === "PerplexityBot");

    expect(gptBot?.allowed).toBe(false);
    expect(oaiSearch?.allowed).toBe(true);
    expect(perplexity?.allowed).toBe(true);
  });

  it("scores page AI-citation readiness and generates specification-compliant /llms.txt", () => {
    const readyPage = computePageCitationReadiness({
      id: "00000000-0000-0000-0000-000000000099",
      url: "https://rankpilot.example.com/guides/geo",
      title: "Generative Engine Optimization (GEO) Guide",
      metaDescription:
        "Generative Engine Optimization is the engineering framework for getting cited in AI Overviews, ChatGPT Search, and Perplexity.",
      h1: ["Generative Engine Optimization (GEO) Guide"],
      headings: [
        { level: 2, text: "What Is Generative Engine Optimization?" },
        { level: 2, text: "How Do AI Answer Engines Select Citations?" },
      ],
      wordCount: 850,
      schemaTypes: ["Article", "FAQPage"],
      robotsMeta: "index,follow",
      statusCode: 200,
      summary:
        "Generative Engine Optimization is the engineering framework for getting cited in AI Overviews, ChatGPT Search, and Perplexity with structured data and direct answers.",
    });

    expect(readyPage.score).toBe(100);
    expect(readyPage.recommendations).toHaveLength(0);

    const llmsTxt = generateLlmsTxtMarkdown({
      projectName: "RankPilot",
      projectUrl: "https://rankpilot.example.com",
      niche: "AI SEO Software",
      audience: "Developers and SaaS Teams",
      pages: [
        {
          url: "https://rankpilot.example.com/guides/geo",
          title: "GEO Guide",
          metaDescription: "Complete guide to AI Search optimization.",
          summary: null,
          inlinks: 10,
        },
      ],
    });

    expect(llmsTxt).toContain("# RankPilot");
    expect(llmsTxt).toContain("[GEO Guide](https://rankpilot.example.com/guides/geo)");
    expect(llmsTxt).toContain("## Machine-Readable Endpoints");
  });

  it("computes deterministic SHA-256 approval payload hashes and exports Markdown, CSV, JSON, and Git patches", () => {
    const h1 = computeApprovalPayloadHash({ taskId: "t1", decision: "approve" });
    const h2 = computeApprovalPayloadHash({ taskId: "t1", decision: "approve" });
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);

    const sampleTasks: TaskItemDto[] = [
      {
        id: "00000000-0000-0000-0000-000000000101",
        projectId: "00000000-0000-0000-0000-000000000001",
        issueId: null,
        source: "audit",
        title: "Add self-referencing canonical tag to /pricing",
        description: "Prevents duplicate URL parameter dilution.",
        impact: 5,
        effort: 1,
        confidence: 1.0,
        priority: 100,
        status: "in_progress",
        position: 0,
        fix: {
          ruleId: "TECH-CANON-001",
          snippet: '<link rel="canonical" href="https://rankpilot.example.com/pricing" />',
        },
        approvedBy: "u1",
        approvedAt: "2026-10-23T12:00:00.000Z",
        createdAt: "2026-10-23T11:00:00.000Z",
        updatedAt: "2026-10-23T12:00:00.000Z",
      },
    ];

    const md = formatTasksExportBundle(sampleTasks, "markdown");
    expect(md.content).toContain("[P100] Add self-referencing canonical tag");
    expect(md.content).toContain('rel="canonical"');

    const patch = formatTasksExportBundle(sampleTasks, "git_patch");
    expect(patch.content).toContain("diff --git a/seo-fixes/");
    expect(patch.content).toContain('+<link rel="canonical"');

    const csv = formatTasksExportBundle(sampleTasks, "csv");
    expect(csv.content).toContain("id,priority,status,source");
    expect(csv.content).toContain("100,in_progress,audit");

    const json = formatTasksExportBundle(sampleTasks, "json");
    expect(JSON.parse(json.content).count).toBe(1);
  });

  it("renders print-ready executive HTML reports in both English ('en') and Bengali ('bn')", () => {
    const baseData = {
      projectName: "RankPilot",
      projectUrl: "https://rankpilot.example.com",
      period: "weekly" as const,
      rangeStart: "2026-10-16",
      rangeEnd: "2026-10-23",
      healthScore: 94,
      pagesCrawled: 42,
      issuesSummary: { critical: 0, warning: 2, info: 3, fixed: 11 },
      gscSummary: {
        clicks: 1280,
        impressions: 34500,
        avgCtrPct: 3.7,
        avgPosition: 6.4,
      },
      keywordsTrackedCount: 15,
      tasksSummary: { todo: 2, inProgress: 3, done: 8, approved: 11 },
      topPriorityTasks: [
        {
          title: "Embed FAQPage JSON-LD on top landing pages",
          priority: 88,
          status: "in_progress",
        },
      ],
      generatedAt: "2026-10-23T12:30:00.000Z",
    };

    const enHtml = renderExecutiveReportHtml({ ...baseData, locale: "en" });
    expect(enHtml).toContain("Executive SEO & GEO Report");
    expect(enHtml).toContain("94/100");
    expect(enHtml).toContain("@media print");

    const bnHtml = renderExecutiveReportHtml({ ...baseData, locale: "bn" });
    expect(bnHtml).toContain('lang="bn"');
    expect(bnHtml).toContain("এক্সিকিউটিভ SEO ও GEO রিপোর্ট");
    expect(bnHtml).toContain("SEO হেলথ স্কোর");
  });
});
