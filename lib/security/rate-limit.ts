import { sql } from "drizzle-orm";
import { getAdminDb } from "@/lib/db/client";

export interface RateLimitConfig {
  /** Bucket capacity (max burst). */
  capacity: number;
  /** Tokens refilled per second. */
  refillPerSec: number;
}

export const RATE_LIMIT_BUCKETS = {
  api_write: { capacity: 30, refillPerSec: 1 },
  agent_chat: { capacity: 10, refillPerSec: 0.2 },
  crawl_start: { capacity: 5, refillPerSec: 0.05 },
  export: { capacity: 10, refillPerSec: 0.2 },
} as const satisfies Record<string, RateLimitConfig>;

export type RateLimitBucketName = keyof typeof RATE_LIMIT_BUCKETS;

export class RateLimitError extends Error {
  readonly status = 429;
  readonly retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super(`Rate limit exceeded. Try again in ${retryAfterSec}s.`);
    this.name = "RateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * Atomic Postgres token-bucket check and decrement.
 */
export async function enforceRateLimit(
  bucket: RateLimitBucketName,
  subjectId: string,
): Promise<{ remaining: number }> {
  const cfg = RATE_LIMIT_BUCKETS[bucket];
  const key = `${bucket}:${subjectId}`;
  const db = getAdminDb();

  const res = await db.execute<{ tokens: number; allowed: boolean }>(sql`
    INSERT INTO rate_limits (key, tokens, refilled_at)
    VALUES (${key}, ${cfg.capacity - 1}, now())
    ON CONFLICT (key) DO UPDATE
      SET tokens = CASE
        WHEN LEAST(
          ${cfg.capacity}::real,
          rate_limits.tokens + EXTRACT(EPOCH FROM (now() - rate_limits.refilled_at))::real * ${cfg.refillPerSec}::real
        ) >= 1.0
        THEN LEAST(
          ${cfg.capacity}::real,
          rate_limits.tokens + EXTRACT(EPOCH FROM (now() - rate_limits.refilled_at))::real * ${cfg.refillPerSec}::real
        ) - 1.0
        ELSE LEAST(
          ${cfg.capacity}::real,
          rate_limits.tokens + EXTRACT(EPOCH FROM (now() - rate_limits.refilled_at))::real * ${cfg.refillPerSec}::real
        )
      END,
      refilled_at = now()
    RETURNING
      tokens,
      (
        LEAST(
          ${cfg.capacity}::real,
          rate_limits.tokens + EXTRACT(EPOCH FROM (now() - rate_limits.refilled_at))::real * ${cfg.refillPerSec}::real
        ) >= 0.0
      ) AS allowed
  `);

  const row = res.rows[0];
  if (!row || row.tokens < 0) {
    const retryAfterSec = Math.max(1, Math.ceil(1 / cfg.refillPerSec));
    throw new RateLimitError(retryAfterSec);
  }
  return { remaining: Math.floor(row.tokens) };
}
