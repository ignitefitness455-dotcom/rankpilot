import type { CwvMetricSnapshot } from "@/lib/audit/rules";
import { cwvResults } from "@/lib/db/schema";
import { withUserDb } from "@/lib/db/rls";
import { getEnv } from "@/lib/security/env";
import { validateUrlTarget } from "@/lib/security/ssrf";

export interface CruxFetchResult {
  snapshot: CwvMetricSnapshot | null;
  error?: string;
  raw?: unknown;
}

/**
 * Queries the Chrome UX Report (CrUX) v1 API for 28-day p75 real-user field metrics.
 * Requires `GOOGLE_API_KEY` and that the origin/URL has sufficient Chrome traffic to appear in CrUX.
 */
export async function fetchCruxFieldMetrics(
  targetUrl: string,
  formFactor: "PHONE" | "DESKTOP" = "PHONE",
  apiKeyOverride?: string,
): Promise<CruxFetchResult> {
  const strategy: "mobile" | "desktop" = formFactor === "PHONE" ? "mobile" : "desktop";

  try {
    await validateUrlTarget(targetUrl, { allowPrivateIps: false });
  } catch (err) {
    return {
      snapshot: null,
      error: `CrUX requires a public URL (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  const env = getEnv();
  const key = apiKeyOverride || env.GOOGLE_API_KEY || "";
  if (!key) {
    return {
      snapshot: null,
      error: "GOOGLE_API_KEY is required for Chrome UX Report (CrUX) API queries",
    };
  }

  const endpoint = `https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(key)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: targetUrl,
        formFactor,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 404) {
      return {
        snapshot: null,
        error: "URL does not have enough public Chrome traffic to be included in the CrUX dataset",
      };
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        snapshot: null,
        error: `CrUX API returned HTTP ${res.status}${errText ? `: ${errText.slice(0, 160)}` : ""}`,
      };
    }

    const data = (await res.json()) as {
      record?: {
        metrics?: Record<
          string,
          { percentiles?: { p75?: number | string } } | undefined
        >;
      };
    };

    const metrics = data.record?.metrics ?? {};
    const parseP75 = (metricKey: string): number | null => {
      const rawVal = metrics[metricKey]?.percentiles?.p75;
      if (rawVal === undefined || rawVal === null) return null;
      const num = typeof rawVal === "number" ? rawVal : Number(rawVal);
      return Number.isNaN(num) ? null : num;
    };

    const lcpMs = parseP75("largest_contentful_paint");
    const inpMs = parseP75("interaction_to_next_paint");
    const cls = parseP75("cumulative_layout_shift");
    const fcpMs = parseP75("first_contentful_paint");
    const ttfbMs = parseP75("experimental_time_to_first_byte");

    return {
      snapshot: {
        url: targetUrl,
        strategy,
        source: "crux_field",
        lcpMs,
        inpMs,
        cls,
        fcpMs,
        ttfbMs,
        perfScore: null,
      },
      raw: data.record ?? null,
    };
  } catch (err) {
    return {
      snapshot: null,
      error: `CrUX request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function refreshProjectCwvViaCrux(params: {
  userId: string;
  projectId: string;
  url: string;
}): Promise<{
  saved: CwvMetricSnapshot[];
  errors: string[];
}> {
  const saved: CwvMetricSnapshot[] = [];
  const errors: string[] = [];

  for (const formFactor of ["PHONE", "DESKTOP"] as const) {
    const res = await fetchCruxFieldMetrics(params.url, formFactor);
    if (!res.snapshot) {
      if (res.error) errors.push(`${formFactor}: ${res.error}`);
      continue;
    }
    const snap = res.snapshot;
    await withUserDb(params.userId, async (tx) => {
      await tx.insert(cwvResults).values({
        projectId: params.projectId,
        url: snap.url,
        strategy: snap.strategy,
        source: snap.source,
        lcpMs: snap.lcpMs,
        inpMs: snap.inpMs,
        cls: snap.cls,
        fcpMs: snap.fcpMs,
        ttfbMs: snap.ttfbMs,
        perfScore: null,
        raw: res.raw ?? null,
      });
    });
    saved.push(snap);
  }

  return { saved, errors };
}
