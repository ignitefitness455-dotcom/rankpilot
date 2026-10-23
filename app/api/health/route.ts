import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getAdminDb } from "@/lib/db/client";
import { getEnv } from "@/lib/security/env";

export async function GET() {
  const started = Date.now();
  try {
    const env = getEnv();
    const db = getAdminDb();
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({
      ok: true,
      app: env.APP_NAME,
      modelPrimary: env.GEMINI_MODEL_PRIMARY,
      dbLatencyMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Database check failed",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
