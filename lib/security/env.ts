import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const DEV_ONLY_AUTH_SECRET = "dev-only-change-me-32chars-minimum-xxxx";
const DEV_ONLY_ENCRYPTION_KEY = "ZGV2LW9ubHkta2V5LWNoYW5nZS1tZS0zMmJ5dGVzISE=";

/**
 * Load `.env` or fallback to `.env.example` in non-production environments so
 * `npm run dev` and `npm test` work from a clean clone without manual copying.
 */
function ensureEnvLoaded(): void {
  if (process.env.NODE_ENV === "production" || process.env._RANKPILOT_ENV_LOADED === "1") return;
  process.env._RANKPILOT_ENV_LOADED = "1";

  const cwd = process.cwd();
  const candidates = [resolve(cwd, ".env"), resolve(cwd, ".env.example")];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const content = readFileSync(file, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      const commentIdx = val.indexOf(" #");
      if (commentIdx !== -1 && !val.startsWith('"') && !val.startsWith("'")) {
        val = val.slice(0, commentIdx).trim();
      }
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

const boolFromString = z
  .union([z.boolean(), z.string()])
  .transform((v) => {
    if (typeof v === "boolean") return v;
    return v.trim().toLowerCase() === "true" || v.trim() === "1";
  });

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url().default("http://localhost:3000"),
    APP_NAME: z.string().min(1).default("RankPilot"),
    DATABASE_URL: z.string().min(1),
    DATABASE_ADMIN_URL: z.string().min(1).optional(),
    EMBEDDED_PG: boolFromString.default(false),

    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
    AUTH_DEV_LOGIN: boolFromString.default(false),
    AUTH_GOOGLE_ID: z.string().optional().default(""),
    AUTH_GOOGLE_SECRET: z.string().optional().default(""),

    ENCRYPTION_KEY: z.string().refine(
      (val) => {
        try {
          return Buffer.from(val, "base64").byteLength === 32;
        } catch {
          return false;
        }
      },
      { message: "ENCRYPTION_KEY must be base64 encoding of exactly 32 bytes" },
    ),
    ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),
    ENCRYPTION_KEYS_OLD: z.string().optional().default(""),

    GOOGLE_API_KEY: z.string().optional().default(""),
    GEMINI_API_KEY: z.string().optional().default(""),
    GEMINI_MODEL_PRIMARY: z.string().min(1).default("gemini-4-argon"),
    GEMINI_MODEL_FAST: z.string().optional().default(""),

    AI_BUDGET_RUN_USD: z.coerce.number().positive().default(0.5),
    AI_BUDGET_PROJECT_DAY_USD: z.coerce.number().positive().default(2.0),
    AI_BUDGET_USER_MONTH_USD: z.coerce.number().positive().default(20.0),
    AI_MAX_STEPS: z.coerce.number().int().min(1).max(30).default(12),

    CRAWLER_USER_AGENT: z
      .string()
      .min(1)
      .default("RankPilotBot/1.0 (+http://localhost:3000/en/bot)"),
    CRAWLER_MAX_PAGES_DEFAULT: z.coerce.number().int().positive().default(500),
    CRAWLER_MAX_PAGES_HARD: z.coerce.number().int().positive().default(10000),
    CRAWLER_MAX_PAGES_UNVERIFIED: z.coerce.number().int().positive().default(50),
    CRAWLER_MAX_DEPTH_DEFAULT: z.coerce.number().int().positive().default(10),
    CRAWLER_RPS: z.coerce.number().positive().default(1),
    CRAWLER_CONCURRENCY: z.coerce.number().int().positive().default(2),
    CRAWLER_ENABLE_RENDER: boolFromString.default(false),
    CRAWLER_ALLOW_PRIVATE_IPS: boolFromString.default(false),

    SERPAPI_KEY: z.string().optional().default(""),
    SERPER_API_KEY: z.string().optional().default(""),
    DATAFORSEO_LOGIN: z.string().optional().default(""),
    DATAFORSEO_PASSWORD: z.string().optional().default(""),
    OPENAI_API_KEY: z.string().optional().default(""),
    PERPLEXITY_API_KEY: z.string().optional().default(""),
    KEYWORDS_ENABLE_AUTOCOMPLETE: boolFromString.default(false),

    SMTP_URL: z.string().optional().default("smtp://localhost:1025"),
    EMAIL_FROM: z.string().optional().default("RankPilot <reports@localhost>"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    SENTRY_DSN: z.string().optional().default(""),
  })
  .superRefine((val, ctx) => {
    if (val.NODE_ENV === "production") {
      if (val.AUTH_DEV_LOGIN) {
        ctx.addIssue({
          code: "custom",
          path: ["AUTH_DEV_LOGIN"],
          message: "AUTH_DEV_LOGIN must be false in production",
        });
      }
      if (val.AUTH_SECRET === DEV_ONLY_AUTH_SECRET) {
        ctx.addIssue({
          code: "custom",
          path: ["AUTH_SECRET"],
          message: "Refusing to start in production with the default dev AUTH_SECRET",
        });
      }
      if (val.ENCRYPTION_KEY === DEV_ONLY_ENCRYPTION_KEY) {
        ctx.addIssue({
          code: "custom",
          path: ["ENCRYPTION_KEY"],
          message: "Refusing to start in production with the default dev ENCRYPTION_KEY",
        });
      }
      if (val.CRAWLER_ALLOW_PRIVATE_IPS) {
        ctx.addIssue({
          code: "custom",
          path: ["CRAWLER_ALLOW_PRIVATE_IPS"],
          message: "CRAWLER_ALLOW_PRIVATE_IPS must be false in production (SSRF guard)",
        });
      }
      if (val.EMBEDDED_PG) {
        ctx.addIssue({
          code: "custom",
          path: ["EMBEDDED_PG"],
          message: "EMBEDDED_PG cannot be used in production",
        });
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

export function parseEnv(raw: NodeJS.ProcessEnv): AppEnv {
  return envSchema.parse(raw);
}

export function getEnv(): AppEnv {
  if (cachedEnv) return cachedEnv;
  ensureEnvLoaded();
  cachedEnv = parseEnv(process.env);
  return cachedEnv;
}

export function resetEnvCacheForTests(): void {
  cachedEnv = null;
}
