import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { getEnv } from "../security/env";

export type DbSchema = typeof schema;
export type AppDatabase = NodePgDatabase<DbSchema>;

const globalForDb = globalThis as unknown as {
  __rankpilotAppPool?: Pool;
  __rankpilotAdminPool?: Pool;
  __rankpilotAppDb?: AppDatabase;
  __rankpilotAdminDb?: AppDatabase;
};

/**
 * Runtime database pool using `DATABASE_URL` (`rankpilot_app` role, subject to RLS).
 */
export function getAppPool(): Pool {
  if (!globalForDb.__rankpilotAppPool) {
    const env = getEnv();
    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
    pool.on("error", () => {
      // Prevent unhandled error on idle client when server restarts
    });
    globalForDb.__rankpilotAppPool = pool;
  }
  return globalForDb.__rankpilotAppPool;
}

/**
 * Admin / owner pool using `DATABASE_ADMIN_URL` (falls back to `DATABASE_URL`).
 * Used ONLY by Auth.js adapter, rate limiter, migrations, and background worker setup.
 */
export function getAdminPool(): Pool {
  if (!globalForDb.__rankpilotAdminPool) {
    const env = getEnv();
    const pool = new Pool({
      connectionString: env.DATABASE_ADMIN_URL || env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
    });
    pool.on("error", () => {
      // Prevent unhandled error on idle client when server restarts
    });
    globalForDb.__rankpilotAdminPool = pool;
  }
  return globalForDb.__rankpilotAdminPool;
}

export function getAppDb(): AppDatabase {
  if (!globalForDb.__rankpilotAppDb) {
    globalForDb.__rankpilotAppDb = drizzle(getAppPool(), { schema });
  }
  return globalForDb.__rankpilotAppDb;
}

export function getAdminDb(): AppDatabase {
  if (!globalForDb.__rankpilotAdminDb) {
    globalForDb.__rankpilotAdminDb = drizzle(getAdminPool(), { schema });
  }
  return globalForDb.__rankpilotAdminDb;
}

export async function closeAllPools(): Promise<void> {
  if (globalForDb.__rankpilotAppPool) {
    await globalForDb.__rankpilotAppPool.end();
    globalForDb.__rankpilotAppPool = undefined;
    globalForDb.__rankpilotAppDb = undefined;
  }
  if (globalForDb.__rankpilotAdminPool) {
    await globalForDb.__rankpilotAdminPool.end();
    globalForDb.__rankpilotAdminPool = undefined;
    globalForDb.__rankpilotAdminDb = undefined;
  }
}
