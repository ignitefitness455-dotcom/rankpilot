import { z } from "zod";
import { SchemaGenerationInputSchema } from "@/lib/schema-gen/generator";

export const postKeywordResearchSchema = z.object({
  seedKeywords: z
    .array(z.string().trim().min(2).max(120))
    .max(20)
    .optional(),
  autoTrackTop: z.boolean().optional().default(true),
});

export const patchKeywordSchema = z.object({
  tracked: z.boolean().optional(),
});

export const postCompetitorCreateSchema = z.object({
  hostOrUrl: z.string().trim().min(3).max(255),
  name: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const postCompetitorAnalyzeSchema = z.object({
  query: z.string().trim().min(2).max(160),
  competitorUrls: z.array(z.url()).max(5).optional(),
});

export const postPageOptimizeSchema = z.object({
  targetKeyword: z.string().trim().max(120).optional(),
});

export const postContentCreateSchema = z.object({
  targetKeyword: z.string().trim().min(2).max(150),
  title: z.string().trim().max(200).optional(),
  generateInitialDraft: z.boolean().optional().default(true),
});

export const patchContentItemSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  status: z.enum(["draft", "in_review", "approved", "archived"]).optional(),
  bodyMd: z.string().max(100_000).optional(),
});

export const postSchemaGenerateSchema = SchemaGenerationInputSchema;

export const postSchemaValidateSchema = z.object({
  jsonLd: z.union([z.string().min(2), z.record(z.string(), z.unknown())]),
});
