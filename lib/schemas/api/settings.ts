import { z } from "zod";

export const byokKindEnum = z.enum([
  "gemini_key",
  "serpapi",
  "serper",
  "dataforseo",
  "openai",
  "perplexity",
  "smtp",
]);

export type ByokKind = z.infer<typeof byokKindEnum>;

export const putApiKeySchema = z.object({
  secret: z.string().trim().min(4, "Secret is too short").max(2048),
  projectId: z.uuid().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const updateBudgetSettingsSchema = z.object({
  budgetRunUsd: z.coerce.number().min(0.05).max(50),
  budgetProjectDayUsd: z.coerce.number().min(0.2).max(500),
  budgetUserMonthUsd: z.coerce.number().min(1).max(5000),
  useFastModel: z.boolean(),
  locale: z.enum(["en", "bn"]).optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
});
