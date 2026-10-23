import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Finding } from "@/lib/schemas/finding";
import { createdAt, pk, ts, updatedAt } from "./_shared";
import { projects } from "./projects";

const projectRef = () =>
  uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" });

export type CrawlStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export const crawls = pgTable(
  "crawls",
  {
    id: pk(),
    projectId: projectRef(),
    status: text("status").$type<CrawlStatus>().notNull().default("queued"),
    trigger: text("trigger").$type<"manual" | "schedule" | "onboarding" | "agent">().notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    pagesFound: integer("pages_found").notNull().default(0),
    pagesCrawled: integer("pages_crawled").notNull().default(0),
    progress: real("progress").notNull().default(0),
    healthScore: integer("health_score"),
    scoreBreakdown: jsonb("score_breakdown").$type<Record<string, number>>(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("crawls_project_created_idx").on(t.projectId, t.createdAt.desc())],
);

export const pages = pgTable(
  "pages",
  {
    id: pk(),
    projectId: projectRef(),
    crawlId: uuid("crawl_id")
      .notNull()
      .references(() => crawls.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    urlHash: text("url_hash").notNull(),
    finalUrl: text("final_url"),
    statusCode: integer("status_code"),
    redirectChain: jsonb("redirect_chain").$type<{ url: string; status: number }[]>(),
    contentType: text("content_type"),
    title: text("title"),
    metaDescription: text("meta_description"),
    canonical: text("canonical"),
    robotsMeta: text("robots_meta"),
    xRobots: text("x_robots"),
    hreflang: jsonb("hreflang").$type<{ lang: string; href: string }[]>(),
    h1: text("h1").array(),
    headings: jsonb("headings").$type<{ level: number; text: string }[]>(),
    wordCount: integer("word_count"),
    textHash: text("text_hash"),
    depth: integer("depth"),
    inlinks: integer("inlinks").notNull().default(0),
    outlinks: integer("outlinks").notNull().default(0),
    schemaTypes: text("schema_types").array(),
    schemaRaw: jsonb("schema_raw").$type<unknown[]>(),
    hasViewport: boolean("has_viewport"),
    lang: text("lang"),
    bytes: integer("bytes"),
    ttfbMs: integer("ttfb_ms"),
    rendered: boolean("rendered").notNull().default(false),
    injectionFlag: boolean("injection_flag").notNull().default(false),
    summary: text("summary"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("pages_crawl_url_uq").on(t.crawlId, t.urlHash),
    index("pages_crawl_status_idx").on(t.crawlId, t.statusCode),
    index("pages_project_idx").on(t.projectId),
  ],
);

export const links = pgTable(
  "links",
  {
    id: pk(),
    projectId: projectRef(),
    crawlId: uuid("crawl_id")
      .notNull()
      .references(() => crawls.id, { onDelete: "cascade" }),
    fromPageId: uuid("from_page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    toUrl: text("to_url").notNull(),
    toPageId: uuid("to_page_id").references(() => pages.id, { onDelete: "set null" }),
    anchor: text("anchor"),
    rel: text("rel"),
    isInternal: boolean("is_internal").notNull(),
    statusCode: integer("status_code"),
  },
  (t) => [
    index("links_crawl_to_idx").on(t.crawlId, t.toPageId),
    index("links_crawl_from_idx").on(t.crawlId, t.fromPageId),
  ],
);

export type IssueStatus = "open" | "fixed" | "ignored" | "regressed";

export const issues = pgTable(
  "issues",
  {
    id: pk(),
    projectId: projectRef(),
    ruleId: text("rule_id").notNull(),
    category: text("category").$type<Finding["category"]>().notNull(),
    severity: text("severity").$type<Finding["severity"]>().notNull(),
    status: text("status").$type<IssueStatus>().notNull().default("open"),
    firstSeenCrawlId: uuid("first_seen_crawl_id").references(() => crawls.id, {
      onDelete: "set null",
    }),
    lastSeenCrawlId: uuid("last_seen_crawl_id").references(() => crawls.id, {
      onDelete: "set null",
    }),
    fixedCrawlId: uuid("fixed_crawl_id").references(() => crawls.id, { onDelete: "set null" }),
    affectedCount: integer("affected_count").notNull().default(0),
    finding: jsonb("finding").$type<Finding>().notNull(),
    ignoredReason: text("ignored_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("issues_project_rule_uq").on(t.projectId, t.ruleId),
    index("issues_project_status_idx").on(t.projectId, t.status, t.severity),
  ],
);

export const issueInstances = pgTable(
  "issue_instances",
  {
    id: pk(),
    projectId: projectRef(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    crawlId: uuid("crawl_id")
      .notNull()
      .references(() => crawls.id, { onDelete: "cascade" }),
    pageId: uuid("page_id").references(() => pages.id, { onDelete: "cascade" }),
    evidence: jsonb("evidence").$type<Finding["evidence"]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("issue_instances_issue_crawl_idx").on(t.issueId, t.crawlId)],
);

export const cwvResults = pgTable(
  "cwv_results",
  {
    id: pk(),
    projectId: projectRef(),
    url: text("url").notNull(),
    strategy: text("strategy").$type<"mobile" | "desktop">().notNull(),
    source: text("source").$type<"psi_lab" | "crux_field">().notNull(),
    lcpMs: real("lcp_ms"),
    inpMs: real("inp_ms"),
    cls: real("cls"),
    fcpMs: real("fcp_ms"),
    ttfbMs: real("ttfb_ms"),
    perfScore: real("perf_score"),
    raw: jsonb("raw").$type<unknown>(),
    fetchedAt: ts("fetched_at").notNull().default(sql`now()`),
  },
  (t) => [index("cwv_project_url_idx").on(t.projectId, t.url, t.fetchedAt.desc())],
);
