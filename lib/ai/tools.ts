import { and, desc, eq, ilike, isNull } from "drizzle-orm";
import { z } from "zod";
import { safeFetchUrl } from "@/lib/crawler/fetcher";
import { parseHtmlPage } from "@/lib/crawler/parse";
import {
  listProjectCrawls,
  listProjectIssues,
  queueProjectCrawl,
} from "@/lib/crawler/runner";
import { withUserDb } from "@/lib/db/rls";
import {
  ignoredRules,
  links,
  pages,
  tasks,
} from "@/lib/db/schema";
import { fetchCruxFieldMetrics } from "@/lib/google/crux";
import { queryOrSyncGa4Report } from "@/lib/google/ga4";
import {
  inspectUrlIndexStatus,
  queryStoredGscPerformance,
} from "@/lib/google/gsc";
import { fetchPageSpeedInsights } from "@/lib/google/psi";
import { getProjectPerformanceIntelligence } from "@/lib/performance/intelligence";
import { analyzeCompetitorAndSerpGap } from "@/lib/competitors/service";
import {
  createContentBriefAndOptionalDraft,
  generateDraftForContentItem,
} from "@/lib/content/studio";
import { runKeywordResearch } from "@/lib/keywords/service";
import { optimizePageById } from "@/lib/onpage/optimizer";
import {
  generateSchemaJsonLd,
  SchemaGenerationInputSchema,
  validateSchemaJsonLd,
} from "@/lib/schema-gen/generator";
import {
  getProjectGeoOverview,
  runPromptVisibilityChecks,
} from "@/lib/geo/service";
import { generateProjectReport } from "@/lib/reports/service";
import { generateGemini, type GeminiFunctionDeclaration } from "./gemini";
import { wrapUntrustedPageContent } from "./guardrails";
import type { BudgetContext } from "./budget";

export type AgentName =
  | "Orchestrator"
  | "Technical"
  | "Performance"
  | "OnPage"
  | "Keyword"
  | "Competitor"
  | "Content"
  | "Schema"
  | "GEO"
  | "Reporter";

export type ToolSideEffectClass = "R" | "I";

export interface ToolExecutionContext {
  userId: string;
  projectId: string;
  systemInstruction: string;
  budgetCtx: BudgetContext;
}

export interface AgentToolDefinition {
  name: string;
  sideEffectClass: ToolSideEffectClass;
  description: string;
  parameters: Record<string, unknown>;
  argsSchema: z.ZodTypeAny;
  execute: (args: unknown, ctx: ToolExecutionContext) => Promise<Record<string, unknown>>;
}

/**
 * Deterministic task priority score (0–100) from §6 of the Phase 0 plan:
 * `round(20 * impact * confidence * (6 - effort) / 5)`
 */
export function computeTaskPriorityScore(
  impact: number,
  effort: number,
  confidence: number,
): number {
  const clampedImpact = Math.max(1, Math.min(5, Math.round(impact)));
  const clampedEffort = Math.max(1, Math.min(5, Math.round(effort)));
  const clampedConf = Math.max(0, Math.min(1, confidence));
  return Math.max(
    1,
    Math.min(100, Math.round((20 * clampedImpact * clampedConf * (6 - clampedEffort)) / 5)),
  );
}

/**
 * Per-agent server-side tool allowlist (§5.7).
 * Note: Every Gemini call declares the full sorted tool list so the cached prefix stays
 * byte-identical across agents; `isToolAllowedForAgent` enforces permissions server-side.
 */
export const AGENT_TOOL_ALLOWLIST: Record<AgentName, readonly string[]> = {
  Orchestrator: [
    "check_ai_visibility",
    "crawl_site",
    "create_task",
    "fetch_url",
    "ga4_report",
    "generate_brief",
    "generate_content_draft",
    "generate_llms_txt",
    "generate_report",
    "generate_schema",
    "get_crawl_summary",
    "get_crux",
    "get_link_graph",
    "get_pagespeed",
    "get_performance_intelligence",
    "grounded_search",
    "gsc_inspect_url",
    "gsc_query",
    "keyword_suggest",
    "list_issues",
    "list_tasks",
    "optimize_page",
    "query_pages",
    "serp_lookup",
    "validate_schema",
  ],
  Technical: [
    "crawl_site",
    "create_task",
    "fetch_url",
    "get_crawl_summary",
    "get_crux",
    "get_link_graph",
    "get_pagespeed",
    "gsc_inspect_url",
    "list_issues",
    "list_tasks",
    "query_pages",
  ],
  Performance: [
    "create_task",
    "ga4_report",
    "get_crux",
    "get_pagespeed",
    "get_performance_intelligence",
    "gsc_inspect_url",
    "gsc_query",
    "list_issues",
    "list_tasks",
  ],
  OnPage: [
    "create_task",
    "fetch_url",
    "generate_schema",
    "get_crawl_summary",
    "get_link_graph",
    "gsc_query",
    "list_issues",
    "list_tasks",
    "optimize_page",
    "query_pages",
    "validate_schema",
  ],
  Keyword: [
    "create_task",
    "get_performance_intelligence",
    "grounded_search",
    "gsc_query",
    "keyword_suggest",
    "list_tasks",
    "query_pages",
    "serp_lookup",
  ],
  Competitor: [
    "create_task",
    "fetch_url",
    "grounded_search",
    "list_tasks",
    "query_pages",
    "serp_lookup",
  ],
  Content: [
    "create_task",
    "generate_brief",
    "generate_content_draft",
    "get_crawl_summary",
    "get_link_graph",
    "grounded_search",
    "gsc_query",
    "list_issues",
    "list_tasks",
    "query_pages",
  ],
  Schema: [
    "create_task",
    "fetch_url",
    "generate_schema",
    "get_crawl_summary",
    "list_issues",
    "list_tasks",
    "query_pages",
    "validate_schema",
  ],
  GEO: [
    "check_ai_visibility",
    "create_task",
    "fetch_url",
    "generate_llms_txt",
    "get_crawl_summary",
    "grounded_search",
    "list_issues",
    "list_tasks",
    "query_pages",
  ],
  Reporter: [
    "generate_report",
    "get_crawl_summary",
    "ga4_report",
    "get_performance_intelligence",
    "gsc_query",
    "list_issues",
    "list_tasks",
    "query_pages",
  ],
};

export function isToolAllowedForAgent(agent: AgentName, toolName: string): boolean {
  const allowed = AGENT_TOOL_ALLOWLIST[agent] ?? [];
  return allowed.includes(toolName);
}

const RAW_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: "crawl_site",
    sideEffectClass: "I",
    description:
      "Queues a fresh technical SEO crawl and deterministic 40-rule audit for the current project.",
    parameters: {
      type: "object",
      properties: {
        maxPages: {
          type: "integer",
          description: "Maximum pages to crawl (1 to 500).",
        },
      },
    },
    argsSchema: z.object({
      maxPages: z.number().int().min(1).max(500).optional(),
    }),
    execute: async (rawArgs: unknown, ctx: ToolExecutionContext) => {
      const args = rawArgs as { maxPages?: number };
      const crawl = await queueProjectCrawl({
        userId: ctx.userId,
        projectId: ctx.projectId,
        trigger: "agent",
        maxPages: args.maxPages ?? 25,
        executeInBackground: true,
      });
      return {
        source: "crawler",
        crawlId: crawl.id,
        status: crawl.status,
        createdAt: crawl.createdAt.toISOString(),
      };
    },
  },
  {
    name: "create_task",
    sideEffectClass: "I",
    description:
      "Creates a prioritized SEO task in the Action Center (Todo status, pending human approval before export). Respects ignored_rules.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Clear, actionable task title." },
        description: {
          type: "string",
          description: "Plain-language explanation of why it matters and exact steps.",
        },
        impact: { type: "integer", description: "Impact score from 1 (low) to 5 (critical)." },
        effort: { type: "integer", description: "Effort score from 1 (easy) to 5 (hard)." },
        confidence: { type: "number", description: "Confidence score from 0.1 to 1.0." },
        ruleId: { type: "string", description: "Optional audit rule ID (e.g. TECH-META-001)." },
        fixSnippet: {
          type: "string",
          description: "Optional copy-paste HTML, JSON-LD, or text fix.",
        },
      },
      required: ["title", "description", "impact", "effort", "confidence"],
    },
    argsSchema: z.object({
      title: z.string().min(3).max(200),
      description: z.string().min(5).max(2000),
      impact: z.number().int().min(1).max(5),
      effort: z.number().int().min(1).max(5),
      confidence: z.number().min(0.05).max(1),
      ruleId: z.string().optional(),
      fixSnippet: z.string().optional(),
    }),
    execute: async (rawArgs: unknown, ctx: ToolExecutionContext) => {
      const args = rawArgs as {
        title: string;
        description: string;
        impact: number;
        effort: number;
        confidence: number;
        ruleId?: string;
        fixSnippet?: string;
      };

      return withUserDb(ctx.userId, async (tx) => {
        if (args.ruleId) {
          const [ignored] = await tx
            .select()
            .from(ignoredRules)
            .where(
              and(
                eq(ignoredRules.projectId, ctx.projectId),
                eq(ignoredRules.ruleId, args.ruleId),
              ),
            )
            .limit(1);
          if (ignored) {
            return {
              created: false,
              skippedReason: `Rule ${args.ruleId} is in the project's ignored_rules list (${ignored.reason ?? "dismissed by user"}).`,
            };
          }
        }

        const priority = computeTaskPriorityScore(args.impact, args.effort, args.confidence);
        const [inserted] = await tx
          .insert(tasks)
          .values({
            projectId: ctx.projectId,
            source: "agent",
            title: args.title,
            description: args.description,
            impact: args.impact,
            effort: args.effort,
            confidence: args.confidence,
            priority,
            status: "todo",
            fix: args.fixSnippet
              ? { type: "snippet", snippet: args.fixSnippet, ruleId: args.ruleId ?? null }
              : null,
          })
          .returning();

        return {
          created: true,
          taskId: inserted!.id,
          title: inserted!.title,
          priority: inserted!.priority,
          status: inserted!.status,
          requiresHumanApproval: true,
        };
      });
    },
  },
  {
    name: "fetch_url",
    sideEffectClass: "R",
    description:
      "Fetches and parses a live web page through the SSRF-protected fetcher, returning SEO metadata and <untrusted_page_content>.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full https:// or http:// URL to inspect." },
      },
      required: ["url"],
    },
    argsSchema: z.object({
      url: z.url(),
    }),
    execute: async (rawArgs: unknown) => {
      const { url } = rawArgs as { url: string };
      try {
        const fetched = await safeFetchUrl(url);
        const parsed = parseHtmlPage({
          url,
          finalUrl: fetched.finalUrl || url,
          statusCode: fetched.statusCode,
          contentType: fetched.contentType,
          headers: fetched.headers,
          html: fetched.body,
          bytes: fetched.bytes,
          ttfbMs: fetched.ttfbMs,
        });
        const wrapped = wrapUntrustedPageContent({
          url: fetched.finalUrl || url,
          rawText: `${parsed.title ?? ""} ${parsed.metaDescription ?? ""} ${parsed.h1.join(" ")}`,
          maxChars: 3000,
        });

        return {
          source: "crawler",
          url,
          finalUrl: fetched.finalUrl,
          statusCode: fetched.statusCode,
          title: parsed.title,
          metaDescription: parsed.metaDescription,
          canonical: parsed.canonical,
          h1: parsed.h1,
          wordCount: parsed.wordCount,
          schemaTypes: parsed.schemaTypes,
          injectionFlagged: wrapped.flagged || parsed.injectionFlag,
          untrustedContentXml: wrapped.wrappedXml,
          fetchedAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          url,
          ok: false,
          error: err instanceof Error ? err.message : "Failed to fetch URL",
          fetchedAt: new Date().toISOString(),
        };
      }
    },
  },
  {
    name: "ga4_report",
    sideEffectClass: "R",
    description:
      "Returns Google Analytics 4 (GA4) organic landing page sessions, engaged sessions, engagement rate, and conversions.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Lookback window in days (7 to 90, default 28)." },
      },
    },
    argsSchema: z.object({
      days: z.number().int().min(7).max(90).optional(),
    }),
    execute: async (rawArgs: unknown, ctx: ToolExecutionContext) => {
      const { days } = rawArgs as { days?: number };
      const report = await queryOrSyncGa4Report({
        userId: ctx.userId,
        projectId: ctx.projectId,
        days: days ?? 28,
      });
      return {
        source: "ga4",
        isEstimate: report.sourceMode === "demo_seed",
        ...report,
      };
    },
  },
  {
    name: "get_crawl_summary",
    sideEffectClass: "R",
    description:
      "Returns the latest technical crawl status, health score (0-100), category breakdown, and open issue counts for the project.",
    parameters: {
      type: "object",
      properties: {},
    },
    argsSchema: z.object({}),
    execute: async (_args: unknown, ctx: ToolExecutionContext) => {
      const [crawlsList, issuesList] = await Promise.all([
        listProjectCrawls(ctx.userId, ctx.projectId),
        listProjectIssues({ userId: ctx.userId, projectId: ctx.projectId }),
      ]);
      const latest = crawlsList[0] ?? null;
      const openIssues = issuesList.filter(
        (i) => i.status === "open" || i.status === "regressed",
      );
      return {
        source: "crawler",
        hasCrawl: Boolean(latest),
        latestCrawl: latest
          ? {
              id: latest.id,
              status: latest.status,
              pagesFound: latest.pagesFound,
              pagesCrawled: latest.pagesCrawled,
              healthScore: latest.healthScore,
              scoreBreakdown: latest.scoreBreakdown,
              finishedAt: latest.finishedAt ? latest.finishedAt.toISOString() : null,
            }
          : null,
        openIssuesCount: openIssues.length,
        criticalCount: openIssues.filter((i) => i.severity === "critical").length,
        warningCount: openIssues.filter((i) => i.severity === "warning").length,
        infoCount: openIssues.filter((i) => i.severity === "info").length,
      };
    },
  },
  {
    name: "get_crux",
    sideEffectClass: "R",
    description:
      "Queries Chrome UX Report (CrUX) real-user field Core Web Vitals (p75 LCP, INP, CLS, TTFB) for a URL.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public URL to query in CrUX." },
        formFactor: { type: "string", enum: ["PHONE", "DESKTOP"] },
      },
      required: ["url"],
    },
    argsSchema: z.object({
      url: z.url(),
      formFactor: z.enum(["PHONE", "DESKTOP"]).optional(),
    }),
    execute: async (rawArgs: unknown) => {
      const { url, formFactor } = rawArgs as {
        url: string;
        formFactor?: "PHONE" | "DESKTOP";
      };
      const res = await fetchCruxFieldMetrics(url, formFactor ?? "PHONE");
      return {
        source: "crux",
        url,
        snapshot: res.snapshot,
        error: res.error ?? null,
        checkedAt: new Date().toISOString(),
      };
    },
  },
  {
    name: "get_link_graph",
    sideEffectClass: "R",
    description:
      "Returns the internal link graph summary from the latest crawl: orphan pages (0 inlinks), deep pages (depth > 3), and top linked hubs.",
    parameters: {
      type: "object",
      properties: {},
    },
    argsSchema: z.object({}),
    execute: async (_args: unknown, ctx: ToolExecutionContext) => {
      return withUserDb(ctx.userId, async (tx) => {
        const crawledPages = await tx
          .select({
            id: pages.id,
            url: pages.url,
            depth: pages.depth,
            inlinks: pages.inlinks,
            outlinks: pages.outlinks,
            statusCode: pages.statusCode,
          })
          .from(pages)
          .where(eq(pages.projectId, ctx.projectId))
          .orderBy(desc(pages.inlinks))
          .limit(200);

        const orphans = crawledPages.filter(
          (p) => (p.depth === null || p.depth > 0) && p.inlinks === 0,
        );
        const deepPages = crawledPages.filter((p) => (p.depth ?? 0) > 3);
        const topHubs = crawledPages.slice(0, 10);

        const brokenLinks = await tx
          .select({
            toUrl: links.toUrl,
            anchor: links.anchor,
            statusCode: links.statusCode,
          })
          .from(links)
          .where(eq(links.projectId, ctx.projectId))
          .limit(50);

        return {
          source: "crawler",
          totalPagesAnalyzed: crawledPages.length,
          orphanPages: orphans.slice(0, 15),
          deepPages: deepPages.slice(0, 15),
          topHubs,
          sampleLinksCount: brokenLinks.length,
        };
      });
    },
  },
  {
    name: "get_pagespeed",
    sideEffectClass: "R",
    description:
      "Runs Google PageSpeed Insights v5 lab test for a URL and returns LCP, INP, CLS, FCP, TTFB, and Performance Score.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public URL to test with PageSpeed Insights." },
        strategy: { type: "string", enum: ["mobile", "desktop"] },
      },
      required: ["url"],
    },
    argsSchema: z.object({
      url: z.url(),
      strategy: z.enum(["mobile", "desktop"]).optional(),
    }),
    execute: async (rawArgs: unknown) => {
      const { url, strategy } = rawArgs as {
        url: string;
        strategy?: "mobile" | "desktop";
      };
      const res = await fetchPageSpeedInsights(url, strategy ?? "mobile");
      return {
        source: "psi",
        url,
        strategy: strategy ?? "mobile",
        snapshot: res.snapshot,
        error: res.error ?? null,
        checkedAt: new Date().toISOString(),
      };
    },
  },
  {
    name: "get_performance_intelligence",
    sideEffectClass: "R",
    description:
      "Computes deterministic Search Console Performance Intelligence: Quick Wins (positions 4-20), CTR Gaps, Content Decay, Cannibalization, Winners/Losers, and Anomalies.",
    parameters: {
      type: "object",
      properties: {},
    },
    argsSchema: z.object({}),
    execute: async (_args: unknown, ctx: ToolExecutionContext) => {
      const report = await getProjectPerformanceIntelligence(ctx.userId, ctx.projectId);
      return {
        source: "gsc",
        isEstimate: report.dataSource === "demo_seed",
        ...report,
      };
    },
  },
  {
    name: "grounded_search",
    sideEffectClass: "R",
    description:
      "Executes a live Google Search grounded query via Gemini (`googleSearch` tool) and returns cited web sources.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query to ground with live Google Search citations.",
        },
      },
      required: ["query"],
    },
    argsSchema: z.object({
      query: z.string().min(2).max(300),
    }),
    execute: async (rawArgs: unknown, ctx: ToolExecutionContext) => {
      const { query } = rawArgs as { query: string };
      try {
        const res = await generateGemini({
          systemInstruction:
            "You are a technical SEO research assistant. Summarize factual SERP findings for the query and rely strictly on Google Search grounding results.",
          contents: [
            {
              role: "user",
              parts: [{ text: `Research live search results for: ${query}` }],
            },
          ],
          thinking: "LOW",
          useGrounding: true,
          maxOutputTokens: 1024,
          budgetCtx: ctx.budgetCtx,
        });

        return {
          source: "serp_grounded",
          query,
          summary: res.text,
          citations: res.citations,
          webSearchQueries: res.webSearchQueries,
          searchEntryPointHtml: res.searchEntryPointHtml,
          fetchedAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          source: "serp_grounded",
          query,
          summary: null,
          citations: [],
          error: err instanceof Error ? err.message : "Grounding search unavailable",
        };
      }
    },
  },
  {
    name: "gsc_inspect_url",
    sideEffectClass: "R",
    description:
      "Inspects indexation status, canonical, and robots directives for a URL via Google Search Console URL Inspection API (or latest crawl snapshot).",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to inspect." },
      },
      required: ["url"],
    },
    argsSchema: z.object({
      url: z.url(),
    }),
    execute: async (rawArgs: unknown, ctx: ToolExecutionContext) => {
      const { url } = rawArgs as { url: string };
      return inspectUrlIndexStatus({
        userId: ctx.userId,
        projectId: ctx.projectId,
        url,
      });
    },
  },
  {
    name: "gsc_query",
    sideEffectClass: "R",
    description:
      "Queries stored Google Search Console performance rows (clicks, impressions, CTR, average position) by query or page.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "integer", description: "Lookback window in days (7 to 90, default 28)." },
        queryFilter: { type: "string", description: "Optional substring filter on query." },
        pageFilter: { type: "string", description: "Optional substring filter on page URL." },
        limit: { type: "integer", description: "Max rows to return (default 20)." },
      },
    },
    argsSchema: z.object({
      days: z.number().int().min(7).max(90).optional(),
      queryFilter: z.string().optional(),
      pageFilter: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    execute: async (rawArgs: unknown, ctx: ToolExecutionContext) => {
      const args = rawArgs as {
        days?: number;
        queryFilter?: string;
        pageFilter?: string;
        limit?: number;
      };
      const res = await queryStoredGscPerformance({
        userId: ctx.userId,
        projectId: ctx.projectId,
        ...args,
      });
      return {
        source: "gsc",
        ...res,
      };
    },
  },
  {
    name: "list_issues",
    sideEffectClass: "R",
    description:
      "Lists deterministic technical and on-page SEO issues detected for the project, including evidence, why_it_matters, and exact fix snippets.",
    parameters: {
      type: "object",
      properties: {
        severity: {
          type: "string",
          enum: ["critical", "warning", "info"],
          description: "Optional severity filter.",
        },
        category: {
          type: "string",
          description: "Optional category filter (e.g. technical, on_page, performance).",
        },
        limit: { type: "integer", description: "Max issues to return (default 15)." },
      },
    },
    argsSchema: z.object({
      severity: z.enum(["critical", "warning", "info"]).optional(),
      category: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    execute: async (rawArgs: unknown, ctx: ToolExecutionContext) => {
      const args = rawArgs as {
        severity?: "critical" | "warning" | "info";
        category?: string;
        limit?: number;
      };
      const allIssues = await listProjectIssues({
        userId: ctx.userId,
        projectId: ctx.projectId,
        severity: args.severity,
        status: "open",
      });

      const filtered = allIssues
        .filter((i) => !args.category || i.category === args.category)
        .slice(0, args.limit ?? 15)
        .map((i) => ({
          issueId: i.id,
          ruleId: i.ruleId,
          category: i.category,
          severity: i.severity,
          affectedCount: i.affectedCount,
          title: i.finding.title,
          whyItMatters: i.finding.why_it_matters,
          fixSummary: i.finding.fix.steps.join(" "),
          fixSnippet: i.finding.fix.code_snippet ?? null,
          sampleEvidence: i.finding.evidence.slice(0, 3),
        }));

      return {
        source: "crawler",
        totalOpenMatching: filtered.length,
        issues: filtered,
      };
    },
  },
  {
    name: "list_tasks",
    sideEffectClass: "R",
    description:
      "Lists prioritized SEO tasks in the project's Action Center.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["todo", "in_progress", "done", "ignored"],
        },
      },
    },
    argsSchema: z.object({
      status: z.enum(["todo", "in_progress", "done", "ignored"]).optional(),
    }),
    execute: async (rawArgs: unknown, ctx: ToolExecutionContext) => {
      const { status } = rawArgs as { status?: "todo" | "in_progress" | "done" | "ignored" };
      return withUserDb(ctx.userId, async (tx) => {
        const rows = await tx
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.projectId, ctx.projectId),
              isNull(tasks.deletedAt),
              ...(status ? [eq(tasks.status, status)] : []),
            ),
          )
          .orderBy(desc(tasks.priority))
          .limit(25);

        return {
          source: "action_center",
          count: rows.length,
          tasks: rows.map((t) => ({
            id: t.id,
            title: t.title,
            source: t.source,
            impact: t.impact,
            effort: t.effort,
            confidence: t.confidence,
            priority: t.priority,
            status: t.status,
          })),
        };
      });
    },
  },
  {
    name: "query_pages",
    sideEffectClass: "R",
    description:
      "Searches crawled pages in the project inventory and returns status code, title, meta description, H1s, word count, depth, inlinks, and safe wrapped digest.",
    parameters: {
      type: "object",
      properties: {
        search: { type: "string", description: "Optional URL or title substring." },
        limit: { type: "integer", description: "Max pages to return (default 15)." },
      },
    },
    argsSchema: z.object({
      search: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    execute: async (rawArgs: unknown, ctx: ToolExecutionContext) => {
      const { search, limit } = rawArgs as { search?: string; limit?: number };
      return withUserDb(ctx.userId, async (tx) => {
        const rows = await tx
          .select()
          .from(pages)
          .where(
            and(
              eq(pages.projectId, ctx.projectId),
              ...(search ? [ilike(pages.url, `%${search}%`)] : []),
            ),
          )
          .orderBy(desc(pages.inlinks))
          .limit(limit ?? 15);

        return {
          source: "crawler",
          count: rows.length,
          pages: rows.map((p) => {
            const wrapped = wrapUntrustedPageContent({
              url: p.url,
              rawText: p.summary ?? `${p.title ?? ""} ${p.metaDescription ?? ""}`,
              maxChars: 800,
            });
            return {
              pageId: p.id,
              url: p.url,
              statusCode: p.statusCode,
              title: p.title,
              metaDescription: p.metaDescription,
              canonical: p.canonical,
              h1: p.h1,
              wordCount: p.wordCount,
              depth: p.depth,
              inlinks: p.inlinks,
              outlinks: p.outlinks,
              schemaTypes: p.schemaTypes,
              injectionFlag: p.injectionFlag || wrapped.flagged,
              untrustedDigestXml: wrapped.wrappedXml,
            };
          }),
        };
      });
    },
  },
  {
    name: "generate_brief",
    sideEffectClass: "I",
    description:
      "Creates an evidence-backed Content Brief (outline, entities, PAA questions, internal links, E-E-A-T prompts, and schema recommendations) in Content Studio.",
    parameters: {
      type: "object",
      properties: {
        targetKeyword: { type: "string", description: "Target keyword or topic for the brief." },
        title: { type: "string", description: "Optional custom headline." },
        generateInitialDraft: {
          type: "boolean",
          description: "If true, also generates Version 1 of the E-E-A-T article draft.",
        },
      },
      required: ["targetKeyword"],
    },
    argsSchema: z.object({
      targetKeyword: z.string().min(2).max(150),
      title: z.string().max(200).optional(),
      generateInitialDraft: z.boolean().optional(),
    }),
    execute: async (rawArgs: unknown, ctx: ToolExecutionContext) => {
      const args = rawArgs as {
        targetKeyword: string;
        title?: string;
        generateInitialDraft?: boolean;
      };
      const item = await createContentBriefAndOptionalDraft({
        userId: ctx.userId,
        projectId: ctx.projectId,
        targetKeyword: args.targetKeyword,
        title: args.title,
        generateInitialDraft: args.generateInitialDraft ?? false,
      });
      return {
        source: "content_studio",
        contentItemId: item.id,
        title: item.title,
        targetKeyword: item.targetKeyword,
        seoScore: item.seoScore,
        brief: item.brief,
      };
    },
  },
  {
    name: "generate_content_draft",
    sideEffectClass: "I",
    description:
      "Generates an E-E-A-T article draft version (with human experience placeholders and 8-gram shingle originality verification) for an existing Content Studio item.",
    parameters: {
      type: "object",
      properties: {
        contentItemId: { type: "string", description: "UUID of the Content Studio item." },
      },
      required: ["contentItemId"],
    },
    argsSchema: z.object({
      contentItemId: z.uuid(),
    }),
    execute: async (rawArgs: unknown, ctx: ToolExecutionContext) => {
      const { contentItemId } = rawArgs as { contentItemId: string };
      const item = await generateDraftForContentItem({
        userId: ctx.userId,
        contentItemId,
      });
      return {
        source: "content_studio",
        contentItemId: item.id,
        title: item.title,
        seoScore: item.seoScore,
        latestVersion: item.versions[0] ?? null,
      };
    },
  },
  {
    name: "generate_schema",
    sideEffectClass: "R",
    description:
      "Generates and validates a ready-to-paste JSON-LD <script> snippet for Article, FAQPage, HowTo, Product, SoftwareApplication, Organization, BreadcrumbList, or LocalBusiness.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: [
            "Article",
            "FAQPage",
            "HowTo",
            "Product",
            "SoftwareApplication",
            "Organization",
            "BreadcrumbList",
            "LocalBusiness",
          ],
        },
        payload: {
          type: "object",
          description: "Schema fields matching the selected schema.org type.",
        },
      },
      required: ["type", "payload"],
    },
    argsSchema: z.object({
      type: z.enum([
        "Article",
        "FAQPage",
        "HowTo",
        "Product",
        "SoftwareApplication",
        "Organization",
        "BreadcrumbList",
        "LocalBusiness",
      ]),
      payload: z.record(z.string(), z.unknown()),
    }),
    execute: async (rawArgs: unknown) => {
      const { type, payload } = rawArgs as {
        type: string;
        payload: Record<string, unknown>;
      };
      const parsed = SchemaGenerationInputSchema.parse({ ...payload, type });
      const res = generateSchemaJsonLd(parsed);
      return {
        source: "schema_generator",
        ...res,
      };
    },
  },
  {
    name: "keyword_suggest",
    sideEffectClass: "I",
    description:
      "Expands seed keywords with Search Console queries and crawled page topics, classifies search intent, groups into topic clusters, and scores keyword priority.",
    parameters: {
      type: "object",
      properties: {
        seedKeywords: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of seed keywords to expand.",
        },
      },
    },
    argsSchema: z.object({
      seedKeywords: z.array(z.string().min(2).max(100)).max(15).optional(),
    }),
    execute: async (rawArgs: unknown, ctx: ToolExecutionContext) => {
      const { seedKeywords } = rawArgs as { seedKeywords?: string[] };
      const overview = await runKeywordResearch({
        userId: ctx.userId,
        projectId: ctx.projectId,
        seedKeywords,
      });
      return {
        source: "keyword_research",
        totalKeywords: overview.keywords.length,
        topKeywords: overview.keywords.slice(0, 15),
        clusters: overview.clusters.slice(0, 10),
        honestPolicyNotice: overview.honestPolicyNotice,
      };
    },
  },
  {
    name: "optimize_page",
    sideEffectClass: "R",
    description:
      "Runs the On-Page Optimizer on a crawled page ID: generates 3 title/meta variants with character & pixel counts, entity gaps, heading fixes, internal link opportunities, and JSON-LD.",
    parameters: {
      type: "object",
      properties: {
        pageId: { type: "string", description: "UUID of the crawled page." },
        targetKeyword: { type: "string", description: "Optional explicit target keyword." },
      },
      required: ["pageId"],
    },
    argsSchema: z.object({
      pageId: z.uuid(),
      targetKeyword: z.string().max(120).optional(),
    }),
    execute: async (rawArgs: unknown, ctx: ToolExecutionContext) => {
      const { pageId, targetKeyword } = rawArgs as {
        pageId: string;
        targetKeyword?: string;
      };
      const report = await optimizePageById({
        userId: ctx.userId,
        projectId: ctx.projectId,
        pageId,
        targetKeyword,
      });
      return {
        source: "onpage_optimizer",
        ...report,
      };
    },
  },
  {
    name: "serp_lookup",
    sideEffectClass: "R",
    description:
      "Analyzes SERP features, competitor page structures, and 'what top competitors have that you don't' for a target search query.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Target search query to analyze." },
      },
      required: ["query"],
    },
    argsSchema: z.object({
      query: z.string().min(2).max(160),
    }),
    execute: async (rawArgs: unknown, ctx: ToolExecutionContext) => {
      const { query } = rawArgs as { query: string };
      const report = await analyzeCompetitorAndSerpGap({
        userId: ctx.userId,
        projectId: ctx.projectId,
        query,
      });
      return {
        source: "serp_analyzer",
        ...report,
      };
    },
  },
  {
    name: "validate_schema",
    sideEffectClass: "R",
    description:
      "Validates a JSON-LD structured data snippet against schema.org and Google Rich Results required properties.",
    parameters: {
      type: "object",
      properties: {
        jsonLd: {
          type: "string",
          description: "Raw JSON-LD string or <script type=\"application/ld+json\"> block.",
        },
      },
      required: ["jsonLd"],
    },
    argsSchema: z.object({
      jsonLd: z.string().min(2),
    }),
    execute: async (rawArgs: unknown) => {
      const { jsonLd } = rawArgs as { jsonLd: string };
      const res = validateSchemaJsonLd(jsonLd);
      return {
        source: "schema_validator",
        ...res,
      };
    },
  },
  {
    name: "generate_llms_txt",
    sideEffectClass: "R",
    description:
      "Evaluates AI search crawler access (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended), page citation readiness, and generates a specification-compliant /llms.txt file.",
    parameters: {
      type: "object",
      properties: {},
    },
    argsSchema: z.object({}),
    execute: async (_args: unknown, ctx: ToolExecutionContext) => {
      const overview = await getProjectGeoOverview(ctx.userId, ctx.projectId);
      return {
        source: "geo_engine",
        overallGeoScore: overview.overallGeoScore,
        aiCrawlerStatus: overview.aiCrawlerStatus,
        llmsTxtContent: overview.llmsTxtContent,
        topPageReadiness: overview.pageReadiness.slice(0, 10),
      };
    },
  },
  {
    name: "check_ai_visibility",
    sideEffectClass: "I",
    description:
      "Runs AI visibility checks across tracked prompts in the project and returns citation and mention status.",
    parameters: {
      type: "object",
      properties: {
        promptId: {
          type: "string",
          description: "Optional specific tracked_prompt UUID to check.",
        },
      },
    },
    argsSchema: z.object({
      promptId: z.uuid().optional(),
    }),
    execute: async (rawArgs: unknown, ctx: ToolExecutionContext) => {
      const { promptId } = rawArgs as { promptId?: string };
      const overview = await runPromptVisibilityChecks({
        userId: ctx.userId,
        projectId: ctx.projectId,
        promptId,
      });
      return {
        source: "geo_engine",
        overallGeoScore: overview.overallGeoScore,
        trackedPrompts: overview.trackedPrompts,
      };
    },
  },
  {
    name: "generate_report",
    sideEffectClass: "I",
    description:
      "Generates an executive weekly or monthly SEO & GEO report in English ('en') or Bengali ('bn').",
    parameters: {
      type: "object",
      properties: {
        period: { type: "string", enum: ["weekly", "monthly", "custom"] },
        locale: { type: "string", enum: ["en", "bn"] },
      },
    },
    argsSchema: z.object({
      period: z.enum(["weekly", "monthly", "custom"]).optional().default("weekly"),
      locale: z.enum(["en", "bn"]).optional().default("en"),
    }),
    execute: async (rawArgs: unknown, ctx: ToolExecutionContext) => {
      const args = rawArgs as {
        period?: "weekly" | "monthly" | "custom";
        locale?: "en" | "bn";
      };
      const report = await generateProjectReport({
        userId: ctx.userId,
        projectId: ctx.projectId,
        period: args.period ?? "weekly",
        locale: args.locale ?? "en",
      });
      return {
        source: "reporter",
        reportId: report.id,
        period: report.period,
        rangeStart: report.rangeStart,
        rangeEnd: report.rangeEnd,
        locale: report.locale,
        summary: report.data,
      };
    },
  },
];

const TOOL_DEFINITIONS: AgentToolDefinition[] = [...RAW_TOOL_DEFINITIONS].sort((a, b) =>
  a.name.localeCompare(b.name),
);

const TOOL_BY_NAME = new Map(TOOL_DEFINITIONS.map((t) => [t.name, t]));

/**
 * Returns the full list of Gemini `functionDeclarations`, sorted alphabetically by `name`
 * so the cached prefix never changes between calls.
 */
export function getSortedToolDeclarations(): GeminiFunctionDeclaration[] {
  return TOOL_DEFINITIONS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

export interface ToolExecutionOutcome {
  ok: boolean;
  blockedByAllowlist?: boolean;
  toolName: string;
  durationMs: number;
  result: Record<string, unknown>;
}

/**
 * Validates tool allowlist for `agent`, parses `rawArgs` with Zod, and executes the tool handler.
 */
export async function executeAgentTool(params: {
  agent: AgentName;
  toolName: string;
  rawArgs: unknown;
  ctx: ToolExecutionContext;
}): Promise<ToolExecutionOutcome> {
  const start = Date.now();
  const def = TOOL_BY_NAME.get(params.toolName);
  if (!def) {
    return {
      ok: false,
      toolName: params.toolName,
      durationMs: Date.now() - start,
      result: {
        error: "UNKNOWN_TOOL",
        message: `Tool '${params.toolName}' is not registered.`,
      },
    };
  }

  if (!isToolAllowedForAgent(params.agent, params.toolName)) {
    return {
      ok: false,
      blockedByAllowlist: true,
      toolName: params.toolName,
      durationMs: Date.now() - start,
      result: {
        error: "TOOL_NOT_ALLOWED_FOR_AGENT",
        message: `Specialist agent '${params.agent}' is not permitted to invoke '${params.toolName}'.`,
      },
    };
  }

  const parsedArgs = def.argsSchema.safeParse(params.rawArgs ?? {});
  if (!parsedArgs.success) {
    return {
      ok: false,
      toolName: params.toolName,
      durationMs: Date.now() - start,
      result: {
        error: "INVALID_TOOL_ARGS",
        issues: parsedArgs.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
    };
  }

  try {
    const output = await def.execute(parsedArgs.data, params.ctx);
    return {
      ok: true,
      toolName: params.toolName,
      durationMs: Date.now() - start,
      result: output,
    };
  } catch (err) {
    return {
      ok: false,
      toolName: params.toolName,
      durationMs: Date.now() - start,
      result: {
        error: "TOOL_EXECUTION_ERROR",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
