import { date, index, integer, jsonb, pgTable, real, text, uniqueIndex, uuid, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, pk, ts, updatedAt } from "./_shared";
import { users } from "./auth";
import { projects } from "./projects";

const projectRef = () =>
  uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" });

export const reports = pgTable(
  "reports",
  {
    id: pk(),
    projectId: projectRef(),
    period: text("period").$type<"weekly" | "monthly" | "custom">().notNull(),
    rangeStart: date("range_start", { mode: "string" }).notNull(),
    rangeEnd: date("range_end", { mode: "string" }).notNull(),
    status: text("status").$type<"queued" | "running" | "ready" | "failed">().notNull().default("queued"),
    locale: text("locale").notNull().default("en"),
    data: jsonb("data").$type<unknown>(),
    html: text("html"),
    pdfPath: text("pdf_path"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("reports_project_created_idx").on(t.projectId, t.createdAt.desc())],
);

export const reportSchedules = pgTable("report_schedules", {
  id: pk(),
  projectId: projectRef(),
  cadence: text("cadence").$type<"weekly" | "monthly">().notNull(),
  day: integer("day").notNull(),
  hour: integer("hour").notNull(),
  tz: text("tz").notNull(),
  recipients: text("recipients").array().notNull().default(sql`'{}'::text[]`),
  locale: text("locale").notNull().default("en"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const alerts = pgTable(
  "alerts",
  {
    id: pk(),
    projectId: projectRef(),
    kind: text("kind").notNull(),
    severity: text("severity").$type<"critical" | "warning" | "info">().notNull(),
    title: text("title").notNull(),
    data: jsonb("data").$type<unknown>(),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("alerts_project_created_idx").on(t.projectId, t.createdAt.desc())],
);

/** Daily AI usage roll-up; budget checks read from here. RLS: user_id = app_user(). */
export const usageMetrics = pgTable(
  "usage_metrics",
  {
    id: pk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    model: text("model").notNull(),
    requests: integer("requests").notNull().default(0),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    tokensThinking: integer("tokens_thinking").notNull().default(0),
    tokensCached: integer("tokens_cached").notNull().default(0),
    groundingRequests: integer("grounding_requests").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
  },
  (t) => [
    uniqueIndex("usage_metrics_uq").on(t.userId, t.projectId, t.day, t.model),
    index("usage_metrics_user_day_idx").on(t.userId, t.day),
  ],
);

/** Postgres token-bucket rate limiting for API route classes. No RLS (server-only). */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  tokens: real("tokens").notNull(),
  refilledAt: ts("refilled_at").notNull().default(sql`now()`),
});
