import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, deletedAt, pk, ts, updatedAt } from "./_shared";
import { projects } from "./projects";

const projectRef = () =>
  uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" });

/** Search Console rows (Search Analytics API). Upserted idempotently per day. */
export const searchPerformance = pgTable(
  "search_performance",
  {
    id: pk(),
    projectId: projectRef(),
    date: date("date", { mode: "string" }).notNull(),
    page: text("page").notNull(),
    query: text("query").notNull(),
    country: text("country").notNull().default(""),
    device: text("device").notNull().default(""),
    clicks: integer("clicks").notNull(),
    impressions: integer("impressions").notNull(),
    ctr: real("ctr").notNull(),
    position: real("position").notNull(),
  },
  (t) => [
    uniqueIndex("sp_row_uq").on(t.projectId, t.date, t.page, t.query, t.country, t.device),
    index("sp_project_date_idx").on(t.projectId, t.date),
    index("sp_project_query_idx").on(t.projectId, t.query),
  ],
);

/** GA4 Data API daily rows. */
export const analyticsDaily = pgTable(
  "analytics_daily",
  {
    id: pk(),
    projectId: projectRef(),
    date: date("date", { mode: "string" }).notNull(),
    pagePath: text("page_path").notNull(),
    sourceMedium: text("source_medium").notNull().default(""),
    sessions: integer("sessions").notNull().default(0),
    engagedSessions: integer("engaged_sessions").notNull().default(0),
    conversions: real("conversions").notNull().default(0),
  },
  (t) => [
    uniqueIndex("ad_row_uq").on(t.projectId, t.date, t.pagePath, t.sourceMedium),
    index("ad_project_date_idx").on(t.projectId, t.date),
  ],
);

export type SearchIntent = "informational" | "commercial" | "transactional" | "navigational";

export const keywordClusters = pgTable("keyword_clusters", {
  id: pk(),
  projectId: projectRef(),
  name: text("name").notNull(),
  intent: text("intent").$type<SearchIntent>(),
  pillarKeyword: text("pillar_keyword"),
  priority: integer("priority").notNull().default(0),
  rationale: text("rationale"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const keywords = pgTable(
  "keywords",
  {
    id: pk(),
    projectId: projectRef(),
    clusterId: uuid("cluster_id").references(() => keywordClusters.id, { onDelete: "set null" }),
    keyword: text("keyword").notNull(),
    normalized: text("normalized").notNull(),
    intent: text("intent").$type<SearchIntent>(),
    intentConfidence: real("intent_confidence"),
    /** Only set when a data provider supplied it; never invented. */
    volume: integer("volume"),
    volumeSource: text("volume_source"),
    difficultyEst: real("difficulty_est"),
    difficultyConfidence: real("difficulty_confidence"),
    gscImpressions28d: integer("gsc_impressions_28d"),
    gscPosition: real("gsc_position"),
    priority: integer("priority").notNull().default(0),
    sources: text("sources").array().notNull().default(sql`'{}'::text[]`),
    tracked: boolean("tracked").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("keywords_project_norm_uq").on(t.projectId, t.normalized),
    index("keywords_project_tracked_idx").on(t.projectId, t.tracked),
  ],
);

export const rankHistory = pgTable(
  "rank_history",
  {
    id: pk(),
    projectId: projectRef(),
    keywordId: uuid("keyword_id")
      .notNull()
      .references(() => keywords.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    position: real("position"),
    url: text("url"),
    source: text("source").$type<"gsc" | "serp_provider">().notNull(),
  },
  (t) => [uniqueIndex("rank_history_uq").on(t.keywordId, t.date, t.source)],
);

export const competitors = pgTable(
  "competitors",
  {
    id: pk(),
    projectId: projectRef(),
    host: text("host").notNull(),
    name: text("name"),
    notes: text("notes"),
    autoDiscovered: boolean("auto_discovered").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex("competitors_project_host_uq")
      .on(t.projectId, t.host)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const trackedPrompts = pgTable("tracked_prompts", {
  id: pk(),
  projectId: projectRef(),
  prompt: text("prompt").notNull(),
  locale: text("locale").notNull().default("en"),
  engines: text("engines").array().notNull().default(sql`'{gemini}'::text[]`),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

export const aiVisibilityChecks = pgTable(
  "ai_visibility_checks",
  {
    id: pk(),
    projectId: projectRef(),
    trackedPromptId: uuid("tracked_prompt_id")
      .notNull()
      .references(() => trackedPrompts.id, { onDelete: "cascade" }),
    engine: text("engine").notNull(),
    mentioned: boolean("mentioned").notNull(),
    cited: boolean("cited").notNull(),
    citedUrls: text("cited_urls").array().notNull().default(sql`'{}'::text[]`),
    competitorsMentioned: text("competitors_mentioned").array().notNull().default(sql`'{}'::text[]`),
    answerExcerpt: text("answer_excerpt"),
    raw: jsonb("raw").$type<unknown>(),
    checkedAt: ts("checked_at").notNull().default(sql`now()`),
  },
  (t) => [index("avc_prompt_checked_idx").on(t.trackedPromptId, t.checkedAt.desc())],
);
