import { z } from "zod";

/**
 * Structured output contract for every audit finding (spec §11).
 * Deterministic rules and model-generated findings must both validate against this.
 */
export const findingCategory = z.enum([
  "technical",
  "on_page",
  "content",
  "performance",
  "ai_search",
  "links",
]);
export const findingSeverity = z.enum(["critical", "warning", "info"]);
export const evidenceSource = z.enum(["crawler", "psi", "gsc", "ga4", "serp", "model"]);
export const fixLanguage = z.enum(["html", "json-ld", "nginx", "js", "text"]);

export const evidenceSchema = z.object({
  url: z.string().min(1),
  observed: z.string(),
  source: evidenceSource,
  timestamp: z.iso.datetime({ offset: true }),
});

export const findingSchema = z
  .object({
    id: z.string().regex(/^[A-Z]+(-[A-Z0-9]+)+$/, "stable rule id, e.g. TECH-CANON-003"),
    category: findingCategory,
    severity: findingSeverity,
    title: z.string().min(1).max(200),
    why_it_matters: z.string().min(1).max(400),
    evidence: z.array(evidenceSchema).min(1),
    affected_count: z.number().int().nonnegative(),
    fix: z.object({
      steps: z.array(z.string().min(1)).min(1),
      code_snippet: z.string().nullable(),
      language: fixLanguage,
    }),
    impact: z.number().int().min(1).max(5),
    effort: z.number().int().min(1).max(5),
    confidence: z.number().min(0).max(1),
    is_estimate: z.boolean(),
  })
  .superRefine((f, ctx) => {
    // Principle 1: anything model-sourced must be labelled as an estimate.
    if (f.evidence.some((e) => e.source === "model") && !f.is_estimate) {
      ctx.addIssue({
        code: "custom",
        path: ["is_estimate"],
        message: "Findings with model-sourced evidence must set is_estimate=true",
      });
    }
  });

export type Finding = z.infer<typeof findingSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
