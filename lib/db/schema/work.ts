import { index, integer, jsonb, pgTable, real, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, deletedAt, pk, ts, updatedAt } from "./_shared";
import { users } from "./auth";
import { projects } from "./projects";
import { issues } from "./audit";

const projectRef = () =>
  uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" });

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "budget_exceeded";

export const runs = pgTable(
  "runs",
  {
    id: pk(),
    projectId: projectRef(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    parentRunId: uuid("parent_run_id"),
    kind: text("kind").notNull(),
    agent: text("agent").notNull(),
    status: text("status").$type<RunStatus>().notNull().default("queued"),
    input: jsonb("input").$type<unknown>(),
    output: jsonb("output").$type<unknown>(),
    stepsCount: integer("steps_count").notNull().default(0),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    tokensThinking: integer("tokens_thinking").notNull().default(0),
    tokensCached: integer("tokens_cached").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    budgetUsd: real("budget_usd").notNull(),
    error: text("error"),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("runs_project_created_idx").on(t.projectId, t.createdAt.desc())],
);

export type RunStepType = "plan" | "tool_call" | "tool_result" | "message" | "verify" | "error";

export const runSteps = pgTable(
  "run_steps",
  {
    id: pk(),
    projectId: projectRef(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    type: text("type").$type<RunStepType>().notNull(),
    summary: text("summary").notNull(),
    toolName: text("tool_name"),
    args: jsonb("args").$type<unknown>(),
    result: jsonb("result").$type<unknown>(),
    tokens: integer("tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    status: text("status").$type<"ok" | "error" | "blocked">().notNull().default("ok"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("run_steps_run_idx_uq").on(t.runId, t.idx)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: pk(),
    projectId: projectRef(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    evidence: jsonb("evidence").$type<unknown[]>(),
    actions: jsonb("actions").$type<unknown[]>(),
    createdAt: createdAt(),
  },
  (t) => [index("chat_messages_run_idx").on(t.runId, t.createdAt)],
);

export const contentItems = pgTable("content_items", {
  id: pk(),
  projectId: projectRef(),
  type: text("type").$type<"brief" | "article">().notNull(),
  title: text("title").notNull(),
  targetKeyword: text("target_keyword"),
  status: text("status").$type<"draft" | "in_review" | "approved" | "archived">().notNull().default("draft"),
  brief: jsonb("brief").$type<unknown>(),
  currentVersionId: uuid("current_version_id"),
  seoScore: integer("seo_score"),
  checklist: jsonb("checklist").$type<unknown>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

export const contentVersions = pgTable(
  "content_versions",
  {
    id: pk(),
    projectId: projectRef(),
    contentItemId: uuid("content_item_id")
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    bodyMd: text("body_md").notNull(),
    author: text("author").$type<"user" | "agent">().notNull(),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    originality: jsonb("originality").$type<unknown>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("content_versions_item_version_uq").on(t.contentItemId, t.version)],
);

export type TaskStatus = "todo" | "in_progress" | "done" | "ignored";

export const tasks = pgTable(
  "tasks",
  {
    id: pk(),
    projectId: projectRef(),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    source: text("source").$type<"audit" | "onpage" | "geo" | "perf" | "agent" | "manual">().notNull(),
    title: text("title").notNull(),
    description: text("description"),
    impact: integer("impact").notNull(),
    effort: integer("effort").notNull(),
    confidence: real("confidence").notNull(),
    priority: integer("priority").notNull(),
    status: text("status").$type<TaskStatus>().notNull().default("todo"),
    position: real("position").notNull().default(0),
    assigneeId: text("assignee_id").references(() => users.id, { onDelete: "set null" }),
    fix: jsonb("fix").$type<unknown>(),
    approvedBy: text("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: ts("approved_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("tasks_project_status_priority_idx").on(t.projectId, t.status, t.priority.desc())],
);

/** Append-only audit log of human decisions (approval gate). */
export const approvals = pgTable(
  "approvals",
  {
    id: pk(),
    projectId: projectRef(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    contentItemId: uuid("content_item_id").references(() => contentItems.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").$type<"approve" | "edit" | "dismiss" | "export">().notNull(),
    payloadHash: text("payload_hash").notNull(),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("approvals_project_idx").on(t.projectId, t.at)],
);

/** Rules or patterns the user rejected, so the agent never re-suggests them. */
export const ignoredRules = pgTable("ignored_rules", {
  id: pk(),
  projectId: projectRef(),
  ruleId: text("rule_id"),
  pattern: jsonb("pattern").$type<Record<string, unknown>>(),
  reason: text("reason"),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});
