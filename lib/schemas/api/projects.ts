import { z } from "zod";

export const siteTypeEnum = z.enum([
  "blog",
  "saas",
  "online_tools",
  "ecommerce",
  "local_business",
  "other",
]);

export const profileFieldsSchema = z.object({
  brandVoice: z.string().trim().min(1).max(500),
  audience: z.string().trim().min(1).max(500),
  goals: z.string().trim().min(1).max(500),
  constraints: z.string().trim().min(1).max(500),
  siteType: siteTypeEnum.default("saas"),
  niche: z.string().trim().min(1).max(200),
  countries: z.array(z.string().trim().min(2).max(10)).max(25).default(["US"]),
  languages: z.array(z.string().trim().min(2).max(10)).max(10).default(["en"]),
  competitorHosts: z
    .array(
      z
        .string()
        .trim()
        .transform((val) => {
          try {
            const u = val.includes("://") ? new URL(val) : new URL(`https://${val}`);
            return u.hostname.toLowerCase().replace(/^www\./, "");
          } catch {
            return val.toLowerCase();
          }
        }),
    )
    .max(5)
    .default([]),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required").max(100),
  url: z
    .url("Must be a valid http(s) URL")
    .refine((u) => u.startsWith("http://") || u.startsWith("https://"), {
      message: "URL must start with http:// or https://",
    }),
  cms: z.string().trim().max(60).optional(),
  language: z.string().trim().max(16).optional().default("en"),
  profile: profileFieldsSchema.partial().optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  cms: z.string().trim().max(60).nullable().optional(),
  language: z.string().trim().max(16).nullable().optional(),
  settings: z
    .object({
      crawl: z
        .object({
          maxPages: z.number().int().min(1).max(10000),
          maxDepth: z.number().int().min(1).max(30),
          render: z.boolean(),
          rps: z.number().min(0.2).max(10),
        })
        .optional(),
      budgetProjectDayUsd: z.number().positive().max(500).optional(),
    })
    .optional(),
});

export const addMemberSchema = z.object({
  email: z.email(),
  role: z.enum(["editor", "viewer"]).default("viewer"),
});
