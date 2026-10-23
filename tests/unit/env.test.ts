import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { parseEnv } from "@/lib/security/env";

const VALID_PROD_KEY = randomBytes(32).toString("base64");
const VALID_PROD_SECRET = "prod-secret-with-at-least-32-characters-long!";

describe("lib/security/env — environment validation", () => {
  it("accepts .env.example defaults in development mode", () => {
    const parsed = parseEnv({
      NODE_ENV: "development",
      DATABASE_URL: "postgres://rankpilot_app:rankpilot_app@localhost:5432/rankpilot",
      AUTH_SECRET: "dev-only-change-me-32chars-minimum-xxxx",
      AUTH_DEV_LOGIN: "true",
      ENCRYPTION_KEY: "ZGV2LW9ubHkta2V5LWNoYW5nZS1tZS0zMmJ5dGVzISE=",
      EMBEDDED_PG: "true",
    });
    expect(parsed.NODE_ENV).toBe("development");
    expect(parsed.AUTH_DEV_LOGIN).toBe(true);
    expect(parsed.GEMINI_MODEL_PRIMARY).toBe("gemini-4-argon");
  });

  it("refuses dev-only secrets and flags when NODE_ENV=production", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://user:pass@db.example.com:5432/rankpilot",
        AUTH_SECRET: "dev-only-change-me-32chars-minimum-xxxx",
        AUTH_DEV_LOGIN: "true",
        ENCRYPTION_KEY: "ZGV2LW9ubHkta2V5LWNoYW5nZS1tZS0zMmJ5dGVzISE=",
        CRAWLER_ALLOW_PRIVATE_IPS: "true",
        EMBEDDED_PG: "true",
      }),
    ).toThrow(/AUTH_DEV_LOGIN|AUTH_SECRET|ENCRYPTION_KEY/);
  });

  it("accepts hardened production configuration", () => {
    const parsed = parseEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://user:pass@db.example.com:5432/rankpilot",
      AUTH_SECRET: VALID_PROD_SECRET,
      AUTH_DEV_LOGIN: "false",
      ENCRYPTION_KEY: VALID_PROD_KEY,
      CRAWLER_ALLOW_PRIVATE_IPS: "false",
      EMBEDDED_PG: "false",
    });
    expect(parsed.NODE_ENV).toBe("production");
    expect(parsed.AUTH_DEV_LOGIN).toBe(false);
  });
});
