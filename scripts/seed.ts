import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { closeAllPools, getAdminDb } from "@/lib/db/client";
import {
  aiVisibilityChecks,
  alerts,
  approvals,
  competitors,
  contentItems,
  contentVersions,
  crawls,
  cwvResults,
  issues,
  keywords,
  pages,
  reports,
  reportSchedules,
  tasks,
  trackedPrompts,
  users,
} from "@/lib/db/schema";
import { computeTaskPriorityScore } from "@/lib/ai/tools";
import {
  buildEeatArticleDraftMd,
  buildStructuredContentBrief,
  computeShingleOriginality,
  evaluateContentSeoChecklist,
} from "@/lib/content/studio";
import { createProjectForUser, getUserProjects } from "@/lib/projects/service";
import { renderExecutiveReportHtml, type ReportSummaryData } from "@/lib/reports/service";
import { getOrCreateUserSettings } from "@/lib/settings/service";
import { applyMigrationsAndRls, ensureEmbeddedPostgresRunning } from "./setup";

export const DEV_USER = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "founder@rankpilot.local",
  name: "Solo Site Owner",
};

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export async function ensureDemoSeed(): Promise<{ userId: string; projectId: string }> {
  const adminDb = getAdminDb();

  const [existingUser] = await adminDb
    .select()
    .from(users)
    .where(eq(users.email, DEV_USER.email))
    .limit(1);

  const userId = existingUser?.id ?? DEV_USER.id;
  if (!existingUser) {
    await adminDb.insert(users).values({
      id: DEV_USER.id,
      email: DEV_USER.email,
      name: DEV_USER.name,
      emailVerified: new Date(),
    });
  }

  await getOrCreateUserSettings(userId);
  const existingProjects = await getUserProjects(userId);

  let projectId: string;
  if (existingProjects.length > 0) {
    projectId = existingProjects[0]!.project.id;
  } else {
    const { project } = await createProjectForUser(userId, {
      name: "Acme Cloud Docs",
      url: "https://acme-docs.example.com",
      cms: "Next.js",
      language: "en",
      profile: {
        brandVoice: "Direct, technical yet approachable for solo builders",
        audience: "Startup founders and web developers looking for fast deployment guides",
        goals: "Grow organic signups and AI search citations",
        constraints: "White-hat only; human review on every code or content change",
        siteType: "saas",
        niche: "Developer Tools & Cloud Hosting",
        countries: ["US", "BD", "GB"],
        languages: ["en", "bn"],
        competitorHosts: ["vercel.com", "render.com", "fly.io"],
      },
    });
    projectId = project.id;
  }

  // Idempotently seed module data if no crawls exist yet for this project
  const existingCrawls = await adminDb
    .select({ id: crawls.id })
    .from(crawls)
    .where(eq(crawls.projectId, projectId))
    .limit(1);

  if (existingCrawls.length === 0) {
    const now = new Date();
    const [crawl] = await adminDb
      .insert(crawls)
      .values({
        projectId,
        status: "completed",
        trigger: "onboarding",
        config: { maxPages: 50, maxDepth: 4, respectRobots: true },
        pagesFound: 3,
        pagesCrawled: 3,
        progress: 100,
        healthScore: 88,
        scoreBreakdown: {
          technical: 92,
          on_page: 84,
          content: 86,
          performance: 90,
          ai_search: 88,
        },
        startedAt: new Date(now.getTime() - 45_000),
        finishedAt: now,
      })
      .returning();

    const crawlId = crawl!.id;

    // Seed 3 crawled pages
    const demoPages = [
      {
        url: "https://acme-docs.example.com/",
        title: "Acme Cloud Docs — Fast Next.js & Postgres Deployment Platform",
        metaDescription:
          "Deploy production Next.js applications and managed PostgreSQL databases in under 60 seconds with zero-downtime rollouts.",
        h1: ["Deploy Next.js & Postgres in 60 Seconds"],
        headings: [
          { level: 2, text: "How Does Zero-Downtime Deployment Work?" },
          { level: 2, text: "What Regions Are Supported?" },
        ],
        wordCount: 680,
        inlinks: 14,
        outlinks: 8,
        schemaTypes: ["Organization", "SoftwareApplication"],
        summary:
          "Acme Cloud Docs is the official developer documentation and deployment guide for launching Next.js and PostgreSQL workloads with zero downtime.",
      },
      {
        url: "https://acme-docs.example.com/pricing",
        title: "Pricing Plans — Acme Cloud",
        metaDescription: "Simple usage-based cloud hosting pricing for solo developers and SaaS teams.",
        h1: ["Predictable Cloud Pricing"],
        headings: [
          { level: 2, text: "Can I Start on the Free Hobby Tier?" },
          { level: 2, text: "How Is Database Storage Billed?" },
        ],
        wordCount: 420,
        inlinks: 9,
        outlinks: 5,
        schemaTypes: ["FAQPage"],
        summary:
          "Compare Hobby, Pro, and Enterprise cloud hosting tiers with transparent bandwidth and PostgreSQL storage pricing.",
      },
      {
        url: "https://acme-docs.example.com/guides/nextjs-docker",
        title: "Next.js Docker Deployment Guide",
        metaDescription: null,
        h1: ["Next.js Docker Deployment Guide", "Containerizing App Router"],
        headings: [{ level: 2, text: "Multi-Stage Dockerfile Setup" }],
        wordCount: 240,
        inlinks: 3,
        outlinks: 2,
        schemaTypes: [],
        summary: "Step-by-step guide to building a multi-stage Dockerfile for Next.js standalone mode.",
      },
    ];

    for (const dp of demoPages) {
      await adminDb.insert(pages).values({
        projectId,
        crawlId,
        url: dp.url,
        urlHash: sha256Hex(dp.url),
        finalUrl: dp.url,
        statusCode: 200,
        contentType: "text/html; charset=utf-8",
        title: dp.title,
        metaDescription: dp.metaDescription,
        canonical: dp.url,
        robotsMeta: "index,follow",
        h1: dp.h1,
        headings: dp.headings,
        wordCount: dp.wordCount,
        textHash: sha256Hex(dp.summary),
        depth: dp.url.endsWith(".com/") ? 0 : 1,
        inlinks: dp.inlinks,
        outlinks: dp.outlinks,
        schemaTypes: dp.schemaTypes,
        hasViewport: true,
        lang: "en",
        bytes: 28_400,
        ttfbMs: 145,
        summary: dp.summary,
      });
    }

    // Seed deterministic audit issues
    const [issue1] = await adminDb
      .insert(issues)
      .values({
        projectId,
        ruleId: "ONPAGE-META-DESC-MISSING",
        category: "on_page",
        severity: "warning",
        status: "open",
        firstSeenCrawlId: crawlId,
        lastSeenCrawlId: crawlId,
        affectedCount: 1,
        finding: {
          id: "ONPAGE-META-DESC-MISSING",
          category: "on_page",
          severity: "warning",
          title: "Missing meta description on 1 indexable page",
          why_it_matters:
            "Pages without a meta description rely on arbitrary body snippets in Google Search and AI citations, lowering organic click-through rate.",
          evidence: [
            {
              url: "https://acme-docs.example.com/guides/nextjs-docker",
              observed: "meta description: (missing) — expected 120–158 characters",
              source: "crawler",
              timestamp: now.toISOString(),
            },
          ],
          affected_count: 1,
          fix: {
            steps: [
              "Export a metadata object in app/guides/nextjs-docker/page.tsx with a 140–155 character description.",
              "Re-run the Site Audit and confirm the page no longer appears under this rule.",
            ],
            code_snippet:
              '<meta name="description" content="Learn how to containerize Next.js App Router applications using a production multi-stage Dockerfile with standalone output." />',
            language: "html",
          },
          impact: 4,
          effort: 1,
          confidence: 1.0,
          is_estimate: false,
        },
      })
      .returning();

    // Seed Core Web Vitals snapshot
    await adminDb.insert(cwvResults).values({
      projectId,
      url: "https://acme-docs.example.com/",
      strategy: "mobile",
      source: "psi_lab",
      lcpMs: 1680,
      inpMs: 75,
      cls: 0.02,
      fcpMs: 980,
      ttfbMs: 145,
      perfScore: 96,
    });

    // Seed tracked keywords (GSC-sourced proxies only; volume stays null — never invented)
    await adminDb
      .insert(keywords)
      .values([
        {
          projectId,
          keyword: "nextjs docker deployment",
          normalized: "nextjs docker deployment",
          intent: "informational",
          intentConfidence: 0.9,
          gscImpressions28d: 4200,
          gscPosition: 6.4,
          priority: 88,
          sources: ["gsc"],
          tracked: true,
        },
        {
          projectId,
          keyword: "managed postgres hosting for nextjs",
          normalized: "managed postgres hosting for nextjs",
          intent: "commercial",
          intentConfidence: 0.85,
          gscImpressions28d: 2850,
          gscPosition: 8.1,
          priority: 84,
          sources: ["gsc"],
          tracked: true,
        },
      ])
      .onConflictDoNothing();

    // Seed competitors
    await adminDb
      .insert(competitors)
      .values([
        { projectId, host: "vercel.com", name: "Vercel", autoDiscovered: false },
        { projectId, host: "fly.io", name: "Fly.io", autoDiscovered: false },
      ])
      .onConflictDoNothing();

    // Seed Content Studio brief + v1 draft using the same builders the app uses
    const brief = buildStructuredContentBrief({
      targetKeyword: "nextjs docker deployment",
      brandName: "Acme Cloud Docs",
      crawledPages: demoPages.map((p) => ({ url: p.url, title: p.title })),
    });
    const articleTitle = brief.titleIdeas[0] ?? "Next.js Docker Deployment Guide";
    const draftMd = buildEeatArticleDraftMd({
      title: articleTitle,
      brief,
      brandName: "Acme Cloud Docs",
    });
    const originality = computeShingleOriginality({
      draftMd,
      referenceTexts: demoPages.map((p) => p.summary),
      targetKeyword: brief.targetKeyword,
    });
    const { seoScore, checklist } = evaluateContentSeoChecklist({
      title: articleTitle,
      targetKeyword: brief.targetKeyword,
      bodyMd: draftMd,
      brief,
      originality,
    });

    const [cItem] = await adminDb
      .insert(contentItems)
      .values({
        projectId,
        type: "article",
        title: articleTitle,
        targetKeyword: brief.targetKeyword,
        status: "draft",
        brief,
        seoScore,
        checklist,
      })
      .returning();

    const [cVersion] = await adminDb
      .insert(contentVersions)
      .values({
        projectId,
        contentItemId: cItem!.id,
        version: 1,
        bodyMd: draftMd,
        author: "agent",
        originality,
      })
      .returning();

    await adminDb
      .update(contentItems)
      .set({ currentVersionId: cVersion!.id })
      .where(eq(contentItems.id, cItem!.id));

    // Seed GEO tracked prompt & check
    const [tp] = await adminDb
      .insert(trackedPrompts)
      .values({
        projectId,
        prompt: "How to deploy Next.js with Docker and Postgres?",
        locale: "en",
        engines: ["gemini", "openai", "perplexity"],
        active: true,
      })
      .returning();

    await adminDb.insert(aiVisibilityChecks).values({
      projectId,
      trackedPromptId: tp!.id,
      engine: "gemini",
      mentioned: true,
      cited: true,
      citedUrls: ["https://acme-docs.example.com/guides/nextjs-docker"],
      competitorsMentioned: ["vercel.com"],
      answerExcerpt:
        "Acme Cloud Docs provides a multi-stage Next.js Docker deployment guide using standalone output mode.",
      raw: { mode: "local_index_eval", checkedEngine: "gemini" },
    });

    // Seed Action Center task + approval audit record
    const [seededTask] = await adminDb
      .insert(tasks)
      .values({
        projectId,
        issueId: issue1!.id,
        source: "audit",
        title: "Add meta description to /guides/nextjs-docker",
        description:
          "Pages without a meta description rely on arbitrary body snippets in Google Search and AI citations.",
        impact: 4,
        effort: 1,
        confidence: 1.0,
        priority: computeTaskPriorityScore(4, 1, 1.0),
        status: "in_progress",
        approvedBy: userId,
        approvedAt: now,
        fix: {
          type: "audit_fix",
          ruleId: "ONPAGE-META-DESC-MISSING",
          snippet:
            '<meta name="description" content="Learn how to containerize Next.js App Router applications using a production multi-stage Dockerfile with standalone output." />',
          affectedUrls: ["https://acme-docs.example.com/guides/nextjs-docker"],
        },
      })
      .returning();

    await adminDb.insert(approvals).values({
      projectId,
      taskId: seededTask!.id,
      userId,
      action: "approve",
      payloadHash: sha256Hex(JSON.stringify({ taskId: seededTask!.id, decision: "approve" })),
    });

    // Seed executive report + schedule + alert
    const reportData: ReportSummaryData = {
      projectName: "Acme Cloud Docs",
      projectUrl: "https://acme-docs.example.com",
      period: "weekly",
      rangeStart: new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10),
      rangeEnd: now.toISOString().slice(0, 10),
      locale: "en",
      healthScore: 88,
      pagesCrawled: 3,
      issuesSummary: { critical: 0, warning: 1, info: 0, fixed: 2 },
      gscSummary: { clicks: 355, impressions: 7050, avgCtrPct: 5.0, avgPosition: 7.2 },
      keywordsTrackedCount: 2,
      tasksSummary: { todo: 0, inProgress: 1, done: 1, approved: 1 },
      topPriorityTasks: [
        {
          title: "Add meta description to /guides/nextjs-docker",
          priority: 80,
          status: "in_progress",
        },
      ],
      generatedAt: now.toISOString(),
    };

    await adminDb.insert(reports).values({
      projectId,
      period: "weekly",
      rangeStart: reportData.rangeStart,
      rangeEnd: reportData.rangeEnd,
      status: "ready",
      locale: "en",
      data: reportData,
      html: renderExecutiveReportHtml(reportData),
    });

    await adminDb.insert(reportSchedules).values({
      projectId,
      cadence: "weekly",
      day: 1,
      hour: 9,
      tz: "Asia/Dhaka",
      recipients: ["founder@rankpilot.local"],
      locale: "en",
      active: true,
    });

    await adminDb.insert(alerts).values({
      projectId,
      kind: "audit_completed",
      severity: "info",
      title: "Initial Site Audit completed with Health Score 88/100 (3 pages crawled).",
      data: { crawlId },
    });
  }

  return { userId, projectId };
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).toLowerCase() === resolve(process.cwd(), "scripts", "seed.ts").toLowerCase();

if (isMain) {
  (async () => {
    const stop = await ensureEmbeddedPostgresRunning();
    try {
      await applyMigrationsAndRls();
      const seeded = await ensureDemoSeed();
      console.log("[seed] Demo data ready:", seeded);
    } finally {
      await closeAllPools();
      if (stop) await stop();
    }
    process.exit(0);
  })().catch((err) => {
    console.error("[seed] Failed:", err);
    process.exit(1);
  });
}
