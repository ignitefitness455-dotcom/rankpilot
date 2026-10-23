import type { ProfileFields } from "@/lib/db/schema";

export interface SerializableProjectContext {
  projectId: string;
  name: string;
  url: string;
  host: string;
  cms: string | null;
  language: string | null;
  version: number;
  fields: ProfileFields;
}

export const DEFAULT_PROFILE_FIELDS: ProfileFields = {
  brandVoice: "Clear, helpful, plain-language, trustworthy",
  audience: "Everyday readers and decision-makers looking for practical answers",
  goals: "More qualified organic traffic and conversions",
  constraints: "White-hat only; no unverified claims; human approval before publishing",
  siteType: "saas",
  niche: "General",
  countries: ["US"],
  languages: ["en"],
  competitorHosts: [],
};

/**
 * Produces a byte-identical, timestamp-free `<project_profile>` XML block for a given
 * profile version so Gemini 4 Argon's implicit prefix cache hits across agent calls.
 */
export function serializeProjectProfile(ctx: SerializableProjectContext): string {
  const countries = [...ctx.fields.countries].map((c) => c.trim().toUpperCase()).filter(Boolean).sort();
  const languages = [...ctx.fields.languages].map((l) => l.trim().toLowerCase()).filter(Boolean).sort();
  const competitors = [...ctx.fields.competitorHosts]
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .sort();

  const lines = [
    `<project_profile v="${ctx.version}">`,
    `project_id: ${ctx.projectId}`,
    `name: ${ctx.name.trim()}`,
    `url: ${ctx.url.trim()}`,
    `host: ${ctx.host.trim().toLowerCase()}`,
    `cms: ${(ctx.cms ?? "unknown").trim()}`,
    `primary_language: ${(ctx.language ?? languages[0] ?? "en").trim()}`,
    `site_type: ${ctx.fields.siteType.trim()}`,
    `niche: ${ctx.fields.niche.trim()}`,
    `target_countries: ${countries.join(", ") || "GLOBAL"}`,
    `target_languages: ${languages.join(", ") || "en"}`,
    `competitor_hosts: ${competitors.join(", ") || "none"}`,
    `brand_voice: ${ctx.fields.brandVoice.trim()}`,
    `audience: ${ctx.fields.audience.trim()}`,
    `primary_goals: ${ctx.fields.goals.trim()}`,
    `constraints: ${ctx.fields.constraints.trim()}`,
    `</project_profile>`,
  ];

  return lines.join("\n");
}
