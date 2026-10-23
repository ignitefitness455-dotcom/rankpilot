import { z } from "zod";

export const postTrackedPromptSchema = z.object({
  prompt: z.string().trim().min(3).max(300),
  locale: z.enum(["en", "bn"]).optional().default("en"),
  engines: z
    .array(z.enum(["gemini", "openai", "perplexity"]))
    .min(1)
    .max(3)
    .optional(),
});

export const postRunVisibilityChecksSchema = z.object({
  promptId: z.uuid().optional(),
});

export const postCreateOrSyncTaskSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("sync_from_audit"),
  }),
  z.object({
    action: z.literal("create"),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(2000).optional(),
    impact: z.number().int().min(1).max(5).default(3),
    effort: z.number().int().min(1).max(5).default(2),
    confidence: z.number().min(0.1).max(1).default(0.85),
    ruleId: z.string().trim().max(80).optional(),
    fixSnippet: z.string().max(10_000).optional(),
  }),
]);

export const patchTaskDecisionSchema = z.object({
  status: z.enum(["todo", "in_progress", "done", "ignored"]).optional(),
  decision: z.enum(["approve", "edit", "dismiss"]).optional(),
  editedTitle: z.string().trim().min(3).max(200).optional(),
  editedDescription: z.string().max(4000).optional(),
  editedSnippet: z.string().max(20_000).optional(),
  dismissReason: z.string().trim().max(300).optional(),
});

export const postExportTasksSchema = z.object({
  format: z.enum(["markdown", "json", "csv", "git_patch"]).default("markdown"),
  onlyApproved: z.boolean().optional().default(false),
});

export const postGenerateReportSchema = z.object({
  period: z.enum(["weekly", "monthly", "custom"]).default("weekly"),
  locale: z.enum(["en", "bn"]).default("en"),
});

export const putReportScheduleSchema = z.object({
  cadence: z.enum(["weekly", "monthly"]).default("weekly"),
  day: z.number().int().min(1).max(28).default(1),
  hour: z.number().int().min(0).max(23).default(9),
  tz: z.string().trim().min(2).max(64).default("UTC"),
  recipients: z.array(z.email()).max(10).default([]),
  locale: z.enum(["en", "bn"]).default("en"),
  active: z.boolean().default(true),
});
