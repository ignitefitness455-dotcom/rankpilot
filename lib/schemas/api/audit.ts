import { z } from "zod";

export const verifyOwnershipRequestSchema = z.object({
  method: z.enum(["dns_txt", "meta_tag", "gsc"]),
});

export const startCrawlRequestSchema = z.object({
  maxPages: z.number().int().min(1).max(10_000).optional(),
  maxDepth: z.number().int().min(1).max(20).optional(),
  render: z.boolean().optional(),
  trigger: z.enum(["manual", "schedule", "onboarding", "agent"]).optional().default("manual"),
});

export const updateIssueStatusRequestSchema = z.object({
  status: z.enum(["open", "fixed", "ignored", "regressed"]),
  ignoredReason: z.string().max(400).optional(),
});

export const refreshCwvRequestSchema = z.object({
  url: z.url().optional(),
  source: z.enum(["psi", "crux", "both"]).optional().default("psi"),
});
