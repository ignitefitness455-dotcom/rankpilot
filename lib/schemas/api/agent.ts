import { z } from "zod";

export const agentNameSchema = z.enum([
  "Orchestrator",
  "Technical",
  "Performance",
  "OnPage",
  "Keyword",
  "Competitor",
  "Content",
  "Schema",
  "GEO",
  "Reporter",
]);

export const postAgentChatSchema = z.object({
  message: z.string().trim().min(1, "Message cannot be empty").max(4000),
  agent: agentNameSchema.optional().default("Orchestrator"),
  locale: z.enum(["en", "bn"]).optional().default("en"),
});

export const postAgentActionDecisionSchema = z.object({
  decision: z.enum(["approve", "edit", "dismiss"]),
  editedTitle: z.string().trim().min(1).max(200).optional(),
  editedSnippet: z.string().max(10000).optional(),
  dismissReason: z.string().trim().max(500).optional(),
});
