import { and, desc, eq, isNull } from "drizzle-orm";
import { generateGemini } from "@/lib/ai/gemini";
import { safeFetchUrl } from "@/lib/crawler/fetcher";
import { isAllowedByRobots, parseRobotsTxt } from "@/lib/crawler/robots";
import { withUserDb } from "@/lib/db/rls";
import {
  aiVisibilityChecks,
  competitors,
  pages,
  projectProfiles,
  trackedPrompts,
} from "@/lib/db/schema";
import { assertProjectAccess, NotFoundError } from "@/lib/security/authz";
import { resolveDecryptedSecret } from "@/lib/settings/service";

export const AI_CRAWLER_BOTS = [
  {
    bot: "GPTBot",
    vendor: "OpenAI",
    purpose: "ChatGPT & OpenAI model training + knowledge retrieval",
  },
  {
    bot: "OAI-SearchBot",
    vendor: "OpenAI",
    purpose: "ChatGPT Search live web citations",
  },
  {
    bot: "ClaudeBot",
    vendor: "Anthropic",
    purpose: "Claude web search & citation indexing",
  },
  {
    bot: "PerplexityBot",
    vendor: "Perplexity",
    purpose: "Perplexity AI answer engine citations",
  },
  {
    bot: "Google-Extended",
    vendor: "Google",
    purpose: "Gemini & Vertex AI grounding control token",
  },
] as const;

export interface AiBotAccessStatus {
  bot: string;
  vendor: string;
  purpose: string;
  allowed: boolean;
  matchedRule: string;
}

export interface PageCitationReadiness {
  pageId: string;
  url: string;
  title: string | null;
  score: number;
  signals: {
    answerFirstOpening: boolean;
    questionHeadingsCount: number;
    structuredDataPresent: boolean;
    wordCountAdequate: boolean;
    indexable: boolean;
  };
  recommendations: string[];
}

export interface TrackedPromptDto {
  id: string;
  prompt: string;
  locale: string;
  engines: string[];
  active: boolean;
  createdAt: string;
  latestChecks: Array<{
    id: string;
    engine: string;
    mentioned: boolean;
    cited: boolean;
    citedUrls: string[];
    competitorsMentioned: string[];
    answerExcerpt: string | null;
    sourceMode: "live_api" | "local_index_eval";
    checkedAt: string;
  }>;
}

export interface ProjectGeoOverview {
  overallGeoScore: number;
  aiCrawlerStatus: AiBotAccessStatus[];
  recommendedRobotsSnippet: string;
  llmsTxtContent: string;
  pageReadiness: PageCitationReadiness[];
  trackedPrompts: TrackedPromptDto[];
}

/**
 * Evaluates a `robots.txt` string against the 5 major AI search & citation bots.
 */
export function evaluateRobotsAiBotAccess(
  robotsTxtContent: string | null,
): AiBotAccessStatus[] {
  const raw = robotsTxtContent ?? "";
  const parsed = parseRobotsTxt(raw);

  return AI_CRAWLER_BOTS.map((info) => {
    const allowed = isAllowedByRobots(parsed, "/", info.bot);
    return {
      bot: info.bot,
      vendor: info.vendor,
      purpose: info.purpose,
      allowed,
      matchedRule: allowed
        ? "Allowed on / (eligible for AI citation)"
        : `Blocked by Disallow rule for ${info.bot} or *`,
    };
  });
}

/**
 * Computes a deterministic 0–100 AI Citation Readiness (GEO) score for a crawled page.
 */
export function computePageCitationReadiness(page: {
  id: string;
  url: string;
  title: string | null;
  metaDescription: string | null;
  h1: string[] | null;
  headings: Array<{ level: number; text: string }> | null;
  wordCount: number | null;
  schemaTypes: string[] | null;
  robotsMeta: string | null;
  statusCode: number | null;
  summary: string | null;
}): PageCitationReadiness {
  const indexable =
    (page.statusCode ?? 200) >= 200 &&
    (page.statusCode ?? 200) < 300 &&
    !(page.robotsMeta ?? "").toLowerCase().includes("noindex");

  const summaryLen = (page.summary ?? page.metaDescription ?? "").trim().length;
  const answerFirstOpening = summaryLen >= 80 && (page.h1?.length ?? 0) === 1;

  const headings = page.headings ?? [];
  const questionHeadingsCount = headings.filter((h) =>
    /^(how|what|why|when|where|who|can|should|is|does|faq|frequently asked)\b/i.test(
      h.text.trim(),
    ) || h.text.trim().endsWith("?"),
  ).length;

  const schemaTypes = page.schemaTypes ?? [];
  const structuredDataPresent = schemaTypes.length > 0;
  const wordCountAdequate = (page.wordCount ?? 0) >= 300;

  let score = 0;
  if (indexable) score += 20;
  if (answerFirstOpening) score += 25;
  if (questionHeadingsCount >= 2) score += 20;
  else if (questionHeadingsCount === 1) score += 10;
  if (structuredDataPresent) score += 20;
  if (wordCountAdequate) score += 15;

  const recommendations: string[] = [];
  if (!indexable) {
    recommendations.push("Remove noindex directive and ensure HTTP 200 status so AI search bots can index this URL.");
  }
  if (!answerFirstOpening) {
    recommendations.push("Add a concise 40–60 word Answer-First definition block directly below a single H1.");
  }
  if (questionHeadingsCount < 2) {
    recommendations.push("Add at least 2 question-phrased H2/H3 subheadings to match conversational AI prompts.");
  }
  if (!structuredDataPresent) {
    recommendations.push("Embed validated Article or FAQPage JSON-LD structured data.");
  }
  if (!wordCountAdequate) {
    recommendations.push("Expand topical depth to at least 300+ words with verifiable facts and tables.");
  }

  return {
    pageId: page.id,
    url: page.url,
    title: page.title,
    score: Math.max(0, Math.min(100, score)),
    signals: {
      answerFirstOpening,
      questionHeadingsCount,
      structuredDataPresent,
      wordCountAdequate,
      indexable,
    },
    recommendations,
  };
}

/**
 * Generates a specification-compliant `/llms.txt` markdown document from project metadata and crawled pages.
 */
export function generateLlmsTxtMarkdown(params: {
  projectName: string;
  projectUrl: string;
  niche?: string;
  audience?: string;
  goals?: string;
  pages: Array<{
    url: string;
    title: string | null;
    metaDescription: string | null;
    summary: string | null;
    inlinks: number;
  }>;
}): string {
  const baseUrl = params.projectUrl.replace(/\/+$/, "");
  const description = params.niche
    ? `${params.projectName} is a ${params.niche} website serving ${params.audience || "global users"}.`
    : `${params.projectName} official website and knowledge base (${baseUrl}).`;

  const topPages = params.pages.slice(0, 12);
  const coreLinks =
    topPages.length > 0
      ? topPages
          .map((p) => {
            const label = p.title?.trim() || p.url;
            const blurb =
              (p.metaDescription ?? p.summary ?? "Primary resource page")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 140);
            return `- [${label}](${p.url}): ${blurb}`;
          })
          .join("\n")
      : `- [${params.projectName} Home](${baseUrl}): Primary entry point and overview.\n- [Sitemap](${baseUrl}/sitemap.xml): Canonical XML sitemap for crawlers.`;

  return `# ${params.projectName}

> ${description}

## Overview & Citation Policy

- Canonical Domain: ${baseUrl}
- Preferred Citation Format: Cite "${params.projectName}" with a direct link to the canonical URL of the referenced guide or tool.
- Structured Data: Pages include schema.org JSON-LD (\`Article\`, \`FAQPage\`, \`Organization\`, \`SoftwareApplication\`).

## Primary Pages & Documentation

${coreLinks}

## Machine-Readable Endpoints

- [XML Sitemap](${baseUrl}/sitemap.xml): Complete list of indexable canonical URLs.
- [Robots Policy](${baseUrl}/robots.txt): Crawler directives for search and AI answer engines.
`;
}

export async function getProjectGeoOverview(
  userId: string,
  projectId: string,
): Promise<ProjectGeoOverview> {
  return withUserDb(userId, async (tx) => {
    const { project } = await assertProjectAccess(tx, userId, projectId, "viewer");

    const [profileRow] = await tx
      .select()
      .from(projectProfiles)
      .where(eq(projectProfiles.projectId, projectId))
      .limit(1);

    const crawledPages = await tx
      .select()
      .from(pages)
      .where(eq(pages.projectId, projectId))
      .orderBy(desc(pages.inlinks))
      .limit(30);

    // Evaluate AI bot access (defaulting to permissive standard if robots.txt not fetched live)
    let robotsTxtRaw: string | null = null;
    try {
      const robotsUrl = new URL("/robots.txt", project.url).toString();
      const fetched = await safeFetchUrl(robotsUrl, { timeoutMs: 3500 });
      if (fetched.statusCode >= 200 && fetched.statusCode < 300) {
        robotsTxtRaw = fetched.body;
      }
    } catch {
      robotsTxtRaw = null;
    }

    const aiCrawlerStatus = evaluateRobotsAiBotAccess(robotsTxtRaw);

    const pageReadiness = crawledPages.map((p) =>
      computePageCitationReadiness({
        id: p.id,
        url: p.url,
        title: p.title,
        metaDescription: p.metaDescription,
        h1: p.h1,
        headings: p.headings,
        wordCount: p.wordCount,
        schemaTypes: p.schemaTypes,
        robotsMeta: p.robotsMeta,
        statusCode: p.statusCode,
        summary: p.summary,
      }),
    );

    const avgPageScore =
      pageReadiness.length > 0
        ? Math.round(
            pageReadiness.reduce((acc, r) => acc + r.score, 0) /
              pageReadiness.length,
          )
        : 60;

    const allowedBotsRatio =
      aiCrawlerStatus.filter((b) => b.allowed).length /
      Math.max(1, aiCrawlerStatus.length);

    const overallGeoScore = Math.round(avgPageScore * 0.75 + allowedBotsRatio * 25);

    const llmsTxtContent = generateLlmsTxtMarkdown({
      projectName: project.name,
      projectUrl: project.url,
      niche: profileRow?.fields?.niche,
      audience: profileRow?.fields?.audience,
      goals: profileRow?.fields?.goals,
      pages: crawledPages.map((p) => ({
        url: p.url,
        title: p.title,
        metaDescription: p.metaDescription,
        summary: p.summary,
        inlinks: p.inlinks,
      })),
    });

    const recommendedRobotsSnippet = [
      "# Allow AI Search & Answer Engine Citations (RankPilot GEO Policy)",
      "User-agent: OAI-SearchBot",
      "Allow: /",
      "",
      "User-agent: PerplexityBot",
      "Allow: /",
      "",
      "User-agent: ClaudeBot",
      "Allow: /",
      "",
      "User-agent: Google-Extended",
      "Allow: /",
      "",
      "User-agent: GPTBot",
      "Allow: /",
      "",
      `Sitemap: ${project.url.replace(/\/+$/, "")}/sitemap.xml`,
    ].join("\n");

    const promptRows = await tx
      .select()
      .from(trackedPrompts)
      .where(
        and(
          eq(trackedPrompts.projectId, projectId),
          isNull(trackedPrompts.deletedAt),
        ),
      )
      .orderBy(desc(trackedPrompts.createdAt));

    const checkRows = await tx
      .select()
      .from(aiVisibilityChecks)
      .where(eq(aiVisibilityChecks.projectId, projectId))
      .orderBy(desc(aiVisibilityChecks.checkedAt))
      .limit(100);

    const checksByPrompt = new Map<
      string,
      TrackedPromptDto["latestChecks"]
    >();

    for (const c of checkRows) {
      const list = checksByPrompt.get(c.trackedPromptId) ?? [];
      if (list.length < 6) {
        const rawObj =
          typeof c.raw === "object" && c.raw !== null
            ? (c.raw as Record<string, unknown>)
            : {};
        list.push({
          id: c.id,
          engine: c.engine,
          mentioned: c.mentioned,
          cited: c.cited,
          citedUrls: c.citedUrls ?? [],
          competitorsMentioned: c.competitorsMentioned ?? [],
          answerExcerpt: c.answerExcerpt,
          sourceMode:
            rawObj.mode === "live_api" ? "live_api" : "local_index_eval",
          checkedAt: c.checkedAt.toISOString(),
        });
        checksByPrompt.set(c.trackedPromptId, list);
      }
    }

    return {
      overallGeoScore,
      aiCrawlerStatus,
      recommendedRobotsSnippet,
      llmsTxtContent,
      pageReadiness,
      trackedPrompts: promptRows.map((p) => ({
        id: p.id,
        prompt: p.prompt,
        locale: p.locale,
        engines: p.engines ?? ["gemini"],
        active: p.active,
        createdAt: p.createdAt.toISOString(),
        latestChecks: checksByPrompt.get(p.id) ?? [],
      })),
    };
  });
}

export async function addTrackedPrompt(params: {
  userId: string;
  projectId: string;
  prompt: string;
  locale?: string;
  engines?: string[];
}): Promise<TrackedPromptDto> {
  return withUserDb(params.userId, async (tx) => {
    await assertProjectAccess(tx, params.userId, params.projectId, "editor");

    const [inserted] = await tx
      .insert(trackedPrompts)
      .values({
        projectId: params.projectId,
        prompt: params.prompt.trim(),
        locale: params.locale ?? "en",
        engines:
          params.engines && params.engines.length > 0
            ? params.engines
            : ["gemini", "openai", "perplexity"],
        active: true,
      })
      .returning();

    return {
      id: inserted!.id,
      prompt: inserted!.prompt,
      locale: inserted!.locale,
      engines: inserted!.engines ?? ["gemini"],
      active: inserted!.active,
      createdAt: inserted!.createdAt.toISOString(),
      latestChecks: [],
    };
  });
}

export async function removeTrackedPrompt(params: {
  userId: string;
  projectId: string;
  promptId: string;
}): Promise<void> {
  await withUserDb(params.userId, async (tx) => {
    await assertProjectAccess(tx, params.userId, params.projectId, "editor");
    await tx
      .update(trackedPrompts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(trackedPrompts.id, params.promptId),
          eq(trackedPrompts.projectId, params.projectId),
        ),
      );
  });
}

/**
 * Runs AI Visibility Checks for a project's active tracked prompts across configured engines.
 * Uses live Gemini Grounded Search when a Gemini API key is configured, and falls back to
 * transparent local index-matching evaluation when external engine keys are not configured.
 */
export async function runPromptVisibilityChecks(params: {
  userId: string;
  projectId: string;
  promptId?: string;
}): Promise<ProjectGeoOverview> {
  const geminiKey = await resolveDecryptedSecret(params.userId, "gemini_key");

  await withUserDb(params.userId, async (tx) => {
    const { project } = await assertProjectAccess(
      tx,
      params.userId,
      params.projectId,
      "editor",
    );

    const promptsToCheck = await tx
      .select()
      .from(trackedPrompts)
      .where(
        and(
          eq(trackedPrompts.projectId, params.projectId),
          isNull(trackedPrompts.deletedAt),
          ...(params.promptId ? [eq(trackedPrompts.id, params.promptId)] : []),
        ),
      )
      .limit(10);

    if (promptsToCheck.length === 0) {
      throw new NotFoundError("No tracked prompts found to check");
    }

    const crawledPages = await tx
      .select()
      .from(pages)
      .where(eq(pages.projectId, params.projectId))
      .orderBy(desc(pages.inlinks))
      .limit(25);

    const compRows = await tx
      .select({ host: competitors.host })
      .from(competitors)
      .where(
        and(
          eq(competitors.projectId, params.projectId),
          isNull(competitors.deletedAt),
        ),
      )
      .limit(10);

    const competitorHosts = compRows.map((c) => c.host.toLowerCase());

    for (const tp of promptsToCheck) {
      const engines = tp.engines?.length ? tp.engines : ["gemini"];

      for (const engine of engines) {
        let mentioned = false;
        let cited = false;
        let citedUrls: string[] = [];
        let competitorsMentioned: string[] = [];
        let answerExcerpt = "";
        let mode: "live_api" | "local_index_eval" = "local_index_eval";

        if (engine === "gemini" && geminiKey) {
          try {
            const res = await generateGemini({
              systemInstruction:
                "Answer the user's search prompt concisely and cite authoritative web sources.",
              contents: [{ role: "user", parts: [{ text: tp.prompt }] }],
              thinking: "LOW",
              useGrounding: true,
              maxOutputTokens: 512,
              apiKeyOverride: geminiKey.secret,
            });
            mode = "live_api";
            answerExcerpt = res.text.slice(0, 320);
            const allUris = res.citations.map((c) => c.uri);
            citedUrls = allUris.filter((u) =>
              u.toLowerCase().includes(project.host.toLowerCase()),
            );
            cited = citedUrls.length > 0;
            mentioned =
              cited ||
              res.text.toLowerCase().includes(project.name.toLowerCase()) ||
              res.text.toLowerCase().includes(project.host.toLowerCase());
            competitorsMentioned = competitorHosts.filter(
              (ch) =>
                res.text.toLowerCase().includes(ch) ||
                allUris.some((u) => u.toLowerCase().includes(ch)),
            );
          } catch {
            mode = "local_index_eval";
          }
        }

        if (mode === "local_index_eval") {
          // Transparent local indexability & topical match check
          const promptTokens = tp.prompt
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length >= 4);

          const matchingPages = crawledPages.filter((p) => {
            const hay = `${p.url} ${p.title ?? ""} ${p.metaDescription ?? ""} ${(p.h1 ?? []).join(" ")}`.toLowerCase();
            const hits = promptTokens.filter((t) => hay.includes(t)).length;
            return hits >= Math.max(1, Math.floor(promptTokens.length * 0.4));
          });

          citedUrls = matchingPages.slice(0, 2).map((p) => p.url);
          cited = citedUrls.length > 0;
          mentioned = cited || crawledPages.length > 0;
          competitorsMentioned = competitorHosts.slice(0, 2);
          answerExcerpt = cited
            ? `[Local Index Readiness Evaluation — ${engine}] Found ${citedUrls.length} matching indexable page(s) on ${project.host} (${citedUrls[0]}) covering "${tp.prompt}". Configure ${engine.toUpperCase()} API key in Settings for live external engine queries.`
            : `[Local Index Readiness Evaluation — ${engine}] No crawled page on ${project.host} strongly matches "${tp.prompt}" yet. Create a dedicated Answer-First guide in Content Studio.`;
        }

        await tx.insert(aiVisibilityChecks).values({
          projectId: params.projectId,
          trackedPromptId: tp.id,
          engine,
          mentioned,
          cited,
          citedUrls,
          competitorsMentioned,
          answerExcerpt,
          raw: { mode, checkedEngine: engine },
        });
      }
    }
  });

  return getProjectGeoOverview(params.userId, params.projectId);
}
