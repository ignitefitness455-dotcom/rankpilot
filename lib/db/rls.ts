import { sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { getAppDb, type DbSchema } from "./client";

export type RlsTx = PgTransaction<
  NodePgQueryResultHKT,
  DbSchema,
  ExtractTablesWithRelations<DbSchema>
>;

/**
 * Runs `fn` inside a database transaction with `app.user_id` bound via `set_config(..., true)`
 * so Postgres Row-Level Security policies enforce tenant isolation alongside application checks.
 */
export async function withUserDb<T>(
  userId: string,
  fn: (tx: RlsTx) => Promise<T>,
): Promise<T> {
  if (!userId || typeof userId !== "string") {
    throw new Error("withUserDb requires a non-empty userId");
  }
  const db = getAppDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
