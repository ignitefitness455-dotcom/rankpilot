import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/**
 * Migrations are generated from lib/db/schema and applied with the ADMIN (table owner) role.
 * The runtime app connects with a separate, non-owner role so Row-Level Security applies.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema/index.ts",
  out: "./drizzle/migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_ADMIN_URL ??
      "postgres://postgres:postgres@localhost:5432/rankpilot",
  },
  strict: true,
  verbose: true,
});
