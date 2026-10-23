import { and, eq, gte } from "drizzle-orm";
import { analyticsDaily } from "@/lib/db/schema";
import { withUserDb } from "@/lib/db/rls";
import { assertProjectAccess } from "@/lib/security/authz";
import { resolveGoogleAccessToken } from "./oauth";

export interface Ga4DailyRow {
  date: string;
  pagePath: string;
  sourceMedium: string;
  sessions: number;
  engagedSessions: number;
  conversions: number;
}

function formatDateOffset(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Queries or syncs GA4 organic landing page engagement metrics (`analytics_daily`).
 */
export async function queryOrSyncGa4Report(params: {
  userId: string;
  projectId: string;
  days?: number;
  limit?: number;
}) {
  const days = Math.max(7, Math.min(90, params.days ?? 28));
  const startDate = formatDateOffset(days);

  const existingRows = await withUserDb(params.userId, async (tx) => {
    await assertProjectAccess(tx, params.userId, params.projectId, "viewer");
    return tx
      .select()
      .from(analyticsDaily)
      .where(
        and(eq(analyticsDaily.projectId, params.projectId), gte(analyticsDaily.date, startDate)),
      );
  });

  let sourceMode: "ga4_oauth" | "stored" | "demo_seed" = "stored";
  const workingRows: Ga4DailyRow[] = existingRows.map((r) => ({
    date: r.date,
    pagePath: r.pagePath,
    sourceMedium: r.sourceMedium,
    sessions: r.sessions,
    engagedSessions: r.engagedSessions,
    conversions: r.conversions,
  }));

  if (workingRows.length === 0) {
    const oauth = await resolveGoogleAccessToken(params.userId, params.projectId);
    if (oauth?.accessToken && oauth.ga4PropertyId) {
      try {
        const res = await fetch(
          `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(oauth.ga4PropertyId)}:runReport`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${oauth.accessToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              dateRanges: [{ startDate, endDate: "yesterday" }],
              dimensions: [{ name: "date" }, { name: "pagePath" }, { name: "sessionSourceMedium" }],
              metrics: [
                { name: "sessions" },
                { name: "engagedSessions" },
                { name: "conversions" },
              ],
              limit: 1000,
            }),
          },
        );
        if (res.ok) {
          sourceMode = "ga4_oauth";
          const data = (await res.json()) as {
            rows?: Array<{
              dimensionValues?: Array<{ value?: string }>;
              metricValues?: Array<{ value?: string }>;
            }>;
          };
          for (const r of data.rows ?? []) {
            const rawDate = r.dimensionValues?.[0]?.value ?? "";
            const formattedDate =
              rawDate.length === 8
                ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
                : startDate;
            workingRows.push({
              date: formattedDate,
              pagePath: r.dimensionValues?.[1]?.value ?? "/",
              sourceMedium: r.dimensionValues?.[2]?.value ?? "google / organic",
              sessions: Number(r.metricValues?.[0]?.value ?? 0),
              engagedSessions: Number(r.metricValues?.[1]?.value ?? 0),
              conversions: Number(r.metricValues?.[2]?.value ?? 0),
            });
          }
        }
      } catch {
        // Fall through to demo seed
      }
    }

    if (workingRows.length === 0) {
      sourceMode = "demo_seed";
      const samplePaths = ["/", "/pricing", "/features/technical-seo-audit", "/blog/core-web-vitals-guide"];
      for (let d = days; d >= 1; d--) {
        const date = formatDateOffset(d);
        for (let i = 0; i < samplePaths.length; i++) {
          const sessions = Math.max(4, Math.round((24 - i * 4) * (1 + 0.1 * Math.cos(d * 0.4))));
          const engagedSessions = Math.round(sessions * 0.72);
          const conversions = Number((sessions * (i === 1 ? 0.065 : 0.025)).toFixed(2));
          workingRows.push({
            date,
            pagePath: samplePaths[i]!,
            sourceMedium: "google / organic",
            sessions,
            engagedSessions,
            conversions,
          });
        }
      }
    }

    await withUserDb(params.userId, async (tx) => {
      for (const row of workingRows) {
        await tx
          .insert(analyticsDaily)
          .values({
            projectId: params.projectId,
            date: row.date,
            pagePath: row.pagePath,
            sourceMedium: row.sourceMedium,
            sessions: row.sessions,
            engagedSessions: row.engagedSessions,
            conversions: row.conversions,
          })
          .onConflictDoUpdate({
            target: [
              analyticsDaily.projectId,
              analyticsDaily.date,
              analyticsDaily.pagePath,
              analyticsDaily.sourceMedium,
            ],
            set: {
              sessions: row.sessions,
              engagedSessions: row.engagedSessions,
              conversions: row.conversions,
            },
          });
      }
    });
  }

  const byPath = new Map<
    string,
    { pagePath: string; sessions: number; engagedSessions: number; conversions: number }
  >();
  for (const r of workingRows) {
    const existing = byPath.get(r.pagePath);
    if (existing) {
      existing.sessions += r.sessions;
      existing.engagedSessions += r.engagedSessions;
      existing.conversions = Number((existing.conversions + r.conversions).toFixed(2));
    } else {
      byPath.set(r.pagePath, {
        pagePath: r.pagePath,
        sessions: r.sessions,
        engagedSessions: r.engagedSessions,
        conversions: Number(r.conversions.toFixed(2)),
      });
    }
  }

  const landingPages = [...byPath.values()]
    .map((p) => ({
      ...p,
      engagementRate:
        p.sessions > 0 ? Number((p.engagedSessions / p.sessions).toFixed(4)) : 0,
    }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, params.limit ?? 20);

  return {
    sourceMode,
    startDate,
    days,
    landingPages,
  };
}
