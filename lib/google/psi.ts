import type { CwvMetricSnapshot } from "@/lib/audit/rules";
import { cwvResults } from "@/lib/db/schema";
import { withUserDb } from "@/lib/db/rls";
import { getEnv } from "@/lib/security/env";
import { validateUrlTarget } from "@/lib/security/ssrf";

export interface PsiFetchResult {
  snapshot: CwvMetricSnapshot | null;
  error?: string;
  raw?: unknown;
}

/**
 * Queries Google PageSpeed Insights v5 API for `mobile` or `desktop` lab performance metrics.
 * Never fabricates numbers; if the target is non-public or PSI returns an error/quota limit,
 * returns `snapshot: null` with a clear `error` string.
 */
export async function fetchPageSpeedInsights(
  targetUrl: string,
  strategy: "mobile" | "desktop" = "mobile",
  apiKeyOverride?: string,
): Promise<PsiFetchResult> {
  try {
    await validateUrlTarget(targetUrl, { allowPrivateIps: false });
  } catch (err) {
    return {
      snapshot: null,
      error: `PSI requires a publicly reachable URL (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  const env = getEnv();
  const key = apiKeyOverride || env.GOOGLE_API_KEY || "";

  const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", targetUrl);
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.set("category", "performance");
  if (key) {
    endpoint.searchParams.set("key", key);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    const res = await fetch(endpoint.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        snapshot: null,
        error: `PageSpeed Insights API returned HTTP ${res.status}${errText ? `: ${errText.slice(0, 180)}` : ""}`,
      };
    }

    const data = (await res.json()) as Record<string, unknown>;
    const lighthouse = (data.lighthouseResult ?? {}) as Record<string, unknown>;
    const audits = (lighthouse.audits ?? {}) as Record<
      string,
      { numericValue?: number } | undefined
    >;
    const categories = (lighthouse.categories ?? {}) as Record<
      string,
      { score?: number } | undefined
    >;

    const lcpMs =
      typeof audits["largest-contentful-paint"]?.numericValue === "number"
        ? Math.round(audits["largest-contentful-paint"]!.numericValue!)
        : null;
    const fcpMs =
      typeof audits["first-contentful-paint"]?.numericValue === "number"
        ? Math.round(audits["first-contentful-paint"]!.numericValue!)
        : null;
    const cls =
      typeof audits["cumulative-layout-shift"]?.numericValue === "number"
        ? Number(audits["cumulative-layout-shift"]!.numericValue!.toFixed(4))
        : null;
    const ttfbMs =
      typeof audits["server-response-time"]?.numericValue === "number"
        ? Math.round(audits["server-response-time"]!.numericValue!)
        : null;
    const inpMs =
      typeof audits["experimental-interaction-to-next-paint"]?.numericValue === "number"
        ? Math.round(audits["experimental-interaction-to-next-paint"]!.numericValue!)
        : typeof audits["max-potential-fid"]?.numericValue === "number"
          ? Math.round(audits["max-potential-fid"]!.numericValue!)
          : null;
    const perfScore =
      typeof categories.performance?.score === "number"
        ? Math.round(categories.performance.score * 100)
        : null;

    return {
      snapshot: {
        url: targetUrl,
        strategy,
        source: "psi_lab",
        lcpMs,
        inpMs,
        cls,
        fcpMs,
        ttfbMs,
        perfScore,
      },
      raw: {
        fetchedAt: new Date().toISOString(),
        finalUrl: lighthouse.finalUrl ?? targetUrl,
        lcpMs,
        inpMs,
        cls,
        fcpMs,
        ttfbMs,
        perfScore,
      },
    };
  } catch (err) {
    return {
      snapshot: null,
      error: `PSI request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function refreshProjectCwvViaPsi(params: {
  userId: string;
  projectId: string;
  url: string;
  strategies?: Array<"mobile" | "desktop">;
}): Promise<{
  saved: CwvMetricSnapshot[];
  errors: string[];
}> {
  const strategies = params.strategies ?? ["mobile", "desktop"];
  const saved: CwvMetricSnapshot[] = [];
  const errors: string[] = [];

  for (const strategy of strategies) {
    const res = await fetchPageSpeedInsights(params.url, strategy);
    if (!res.snapshot) {
      if (res.error) errors.push(`${strategy}: ${res.error}`);
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
        perfScore: snap.perfScore,
        raw: res.raw ?? null,
      });
    });
    saved.push(snap);
  }

  return { saved, errors };
}
