"use client";

import * as React from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Gauge,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { Link, useRouter } from "@/lib/i18n/routing";
import { Badge, Button, Card, SeverityBadge } from "@/components/ui/primitives";
import type { Finding } from "@/lib/schemas/finding";

export interface CrawlSummaryRow {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  trigger: string;
  pagesFound: number;
  pagesCrawled: number;
  progress: number;
  healthScore: number | null;
  scoreBreakdown: Record<string, number> | null;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface IssueSummaryRow {
  id: string;
  ruleId: string;
  category: Finding["category"];
  severity: Finding["severity"];
  status: "open" | "fixed" | "ignored" | "regressed";
  affectedCount: number;
  finding: Finding;
}

export interface CwvSummaryRow {
  id: string;
  url: string;
  strategy: "mobile" | "desktop";
  source: "psi_lab" | "crux_field";
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  fcpMs: number | null;
  ttfbMs: number | null;
  perfScore: number | null;
  fetchedAt: string;
}

export interface DashboardAuditPanelProps {
  projectId: string;
  projectUrl: string;
  isVerified: boolean;
  latestCrawl: CrawlSummaryRow | null;
  openIssues: IssueSummaryRow[];
  cwvRows: CwvSummaryRow[];
  labels: {
    healthScoreTitle: string;
    noCrawlYet: string;
    noCrawlDesc: string;
    runAuditButton: string;
    runningAuditLabel: string;
    cancelAuditButton: string;
    topFixesTitle: string;
    viewAllIssues: string;
    cwvTitle: string;
    refreshCwvButton: string;
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  technical: "Technical",
  on_page: "On-Page",
  content: "Content",
  links: "Internal Links",
  performance: "Performance",
  ai_search: "AI Search / GEO",
};

export function DashboardAuditPanel({
  projectId,
  projectUrl,
  isVerified,
  latestCrawl: initialCrawl,
  openIssues,
  cwvRows: initialCwv,
  labels,
}: DashboardAuditPanelProps) {
  const router = useRouter();
  const [crawl, setCrawl] = React.useState<CrawlSummaryRow | null>(initialCrawl);
  const [starting, setStarting] = React.useState(false);
  const [cwvList, setCwvList] = React.useState<CwvSummaryRow[]>(initialCwv);
  const [refreshingCwv, setRefreshingCwv] = React.useState(false);

  const isRunning = crawl?.status === "queued" || crawl?.status === "running";
  const activeCrawlId = crawl?.id;
  const activeCrawlStatus = crawl?.status;

  // Subscribe to SSE crawl progress when a crawl is active
  React.useEffect(() => {
    if (
      !activeCrawlId ||
      (activeCrawlStatus !== "queued" && activeCrawlStatus !== "running")
    ) {
      return;
    }

    const es = new EventSource(`/api/v1/crawls/${activeCrawlId}/events`);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as {
          crawlId: string;
          status: CrawlSummaryRow["status"];
          pagesFound: number;
          pagesCrawled: number;
          progress: number;
          healthScore?: number | null;
          error?: string | null;
        };
        setCrawl((prev) =>
          prev
            ? {
                ...prev,
                status: data.status,
                pagesFound: data.pagesFound,
                pagesCrawled: data.pagesCrawled,
                progress: data.progress,
                healthScore: data.healthScore ?? prev.healthScore,
                error: data.error ?? prev.error,
              }
            : prev,
        );
        if (
          data.status === "completed" ||
          data.status === "failed" ||
          data.status === "cancelled"
        ) {
          es.close();
          router.refresh();
          if (data.status === "completed") {
            toast.success(
              `Site Audit completed — Health Score ${data.healthScore ?? "—"}/100`,
            );
          } else if (data.status === "failed") {
            toast.error(`Crawl failed: ${data.error || "Unknown error"}`);
          }
        }
      } catch {
        // ignore parse errors
      }
    };
    es.onerror = () => {
      es.close();
    };
    return () => {
      es.close();
    };
  }, [activeCrawlId, activeCrawlStatus, router]);

  const handleStartCrawl = async () => {
    setStarting(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/crawls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "manual" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error?.message || "Failed to start crawl");
      }
      const newCrawl = json.data.crawl;
      setCrawl({
        ...newCrawl,
        createdAt: newCrawl.createdAt ?? new Date().toISOString(),
        finishedAt: newCrawl.finishedAt ?? null,
      });
      toast.info(
        isVerified
          ? "Site Audit started in background"
          : "Site Audit started (capped at 50 pages until domain is verified)",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start crawl");
    } finally {
      setStarting(false);
    }
  };

  const handleCancelCrawl = async () => {
    if (!crawl) return;
    try {
      const res = await fetch(`/api/v1/crawls/${crawl.id}/cancel`, {
        method: "POST",
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        setCrawl((prev) => (prev ? { ...prev, status: "cancelled" } : prev));
        toast.info("Crawl cancelled");
        router.refresh();
      }
    } catch {
      toast.error("Failed to cancel crawl");
    }
  };

  const handleRefreshCwv = async () => {
    setRefreshingCwv(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/cwv/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: projectUrl, source: "psi" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error?.message || "CWV refresh failed");
      }
      if (json.data.saved?.length > 0) {
        const listRes = await fetch(`/api/v1/projects/${projectId}/cwv/refresh`);
        const listJson = await listRes.json();
        if (listJson.ok) setCwvList(listJson.data.cwvResults);
        toast.success("Core Web Vitals refreshed via PageSpeed Insights");
      } else {
        toast.warning(
          json.data.errors?.[0] || "No Core Web Vitals returned for this URL",
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to refresh CWV");
    } finally {
      setRefreshingCwv(false);
    }
  };

  const score = crawl?.healthScore ?? null;
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    score !== null ? circumference - (score / 100) * circumference : circumference;
  const scoreColor =
    score === null
      ? "var(--fg-subtle)"
      : score >= 80
        ? "var(--good)"
        : score >= 50
          ? "var(--warning)"
          : "var(--critical)";

  const topFixes = openIssues.slice(0, 5);
  const mobileCwv = cwvList.find((c) => c.strategy === "mobile") ?? cwvList[0] ?? null;

  return (
    <div className="space-y-5">
      {/* Health Score + Category Breakdown + CWV */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--fg)]">
              {labels.healthScoreTitle}
            </h2>
            {crawl ? (
              <Badge
                variant={
                  crawl.status === "completed"
                    ? "brand"
                    : crawl.status === "running" || crawl.status === "queued"
                      ? "info"
                      : "neutral"
                }
              >
                {crawl.status.toUpperCase()}
              </Badge>
            ) : (
              <Badge variant="info">{labels.noCrawlYet}</Badge>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
              <svg className="h-24 w-24 -rotate-90" viewBox="0 0 88 88">
                <circle
                  cx="44"
                  cy="44"
                  r={radius}
                  fill="none"
                  stroke="var(--border-strong)"
                  strokeWidth="7"
                />
                {score !== null && (
                  <circle
                    cx="44"
                    cy="44"
                    r={radius}
                    fill="none"
                    stroke={scoreColor}
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                  />
                )}
              </svg>
              <span
                data-testid="dashboard-health-score"
                className="absolute font-mono text-xl font-bold tabular-nums text-[var(--fg)]"
              >
                {score !== null ? `${score}` : "—"}
                <span className="text-xs text-[var(--fg-subtle)]">/100</span>
              </span>
            </div>

            <div className="space-y-1.5 text-xs text-[var(--fg-muted)]">
              {crawl ? (
                <>
                  <p className="font-medium text-[var(--fg)]">
                    {crawl.pagesCrawled} page{crawl.pagesCrawled === 1 ? "" : "s"} audited
                  </p>
                  <p>
                    {openIssues.filter((i) => i.severity === "critical").length} critical ·{" "}
                    {openIssues.filter((i) => i.severity === "warning").length} warnings ·{" "}
                    {openIssues.filter((i) => i.severity === "info").length} info
                  </p>
                </>
              ) : (
                <p className="leading-relaxed">{labels.noCrawlDesc}</p>
              )}
            </div>
          </div>

          {isRunning ? (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between text-xs text-[var(--fg-muted)]">
                <span>
                  {labels.runningAuditLabel} ({crawl?.pagesCrawled ?? 0}/
                  {crawl?.pagesFound ?? 1} URLs)
                </span>
                <span className="font-mono font-semibold">{Math.round(crawl?.progress ?? 0)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                <div
                  className="h-full bg-[var(--brand)] transition-all duration-300"
                  style={{ width: `${Math.max(5, Math.min(100, crawl?.progress ?? 5))}%` }}
                />
              </div>
              <Button
                size="sm"
                variant="danger"
                onClick={handleCancelCrawl}
                data-testid="cancel-crawl-btn"
              >
                <Square className="h-3.5 w-3.5" />
                {labels.cancelAuditButton}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                onClick={handleStartCrawl}
                disabled={starting}
                data-testid="run-site-audit-btn"
              >
                <Play className="h-3.5 w-3.5" />
                {starting ? labels.runningAuditLabel : labels.runAuditButton}
              </Button>
              <Link href={`/p/${projectId}/audit`}>
                <Button size="sm" variant="secondary">
                  {labels.viewAllIssues}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          )}
        </Card>

        {/* Category Score Breakdown */}
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--fg)]">
              Category Breakdown
            </h2>
            <Activity className="h-4 w-4 text-[var(--fg-subtle)]" />
          </div>

          <div className="space-y-2.5">
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
              const catScore = crawl?.scoreBreakdown?.[key] ?? null;
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[var(--fg)]">{label}</span>
                    <span className="font-mono font-semibold tabular-nums text-[var(--fg-muted)]">
                      {catScore !== null ? `${catScore}/100` : "—"}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${catScore ?? 0}%`,
                        backgroundColor:
                          catScore === null
                            ? "transparent"
                            : catScore >= 80
                              ? "var(--good)"
                              : catScore >= 50
                                ? "var(--warning)"
                                : "var(--critical)",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Core Web Vitals Snapshot */}
        <Card className="flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-[var(--brand)]" />
              <h2 className="text-sm font-semibold text-[var(--fg)]">
                {labels.cwvTitle}
              </h2>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={refreshingCwv}
              onClick={handleRefreshCwv}
              data-testid="refresh-cwv-btn"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshingCwv ? "animate-spin" : ""}`}
              />
              {labels.refreshCwvButton}
            </Button>
          </div>

          {mobileCwv ? (
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-2.5">
                <p className="text-[11px] font-medium text-[var(--fg-muted)]">LCP</p>
                <p className="mt-1 font-mono text-sm font-bold tabular-nums text-[var(--fg)]">
                  {mobileCwv.lcpMs !== null
                    ? `${(mobileCwv.lcpMs / 1000).toFixed(2)}s`
                    : "—"}
                </p>
                <p className="text-[10px] text-[var(--fg-subtle)]">Target ≤ 2.5s</p>
              </div>
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-2.5">
                <p className="text-[11px] font-medium text-[var(--fg-muted)]">INP</p>
                <p className="mt-1 font-mono text-sm font-bold tabular-nums text-[var(--fg)]">
                  {mobileCwv.inpMs !== null ? `${Math.round(mobileCwv.inpMs)}ms` : "—"}
                </p>
                <p className="text-[10px] text-[var(--fg-subtle)]">Target ≤ 200ms</p>
              </div>
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-2.5">
                <p className="text-[11px] font-medium text-[var(--fg-muted)]">CLS</p>
                <p className="mt-1 font-mono text-sm font-bold tabular-nums text-[var(--fg)]">
                  {mobileCwv.cls !== null ? mobileCwv.cls.toFixed(3) : "—"}
                </p>
                <p className="text-[10px] text-[var(--fg-subtle)]">Target ≤ 0.10</p>
              </div>
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-[var(--fg-muted)]">
              No Core Web Vitals snapshot recorded yet. Click &ldquo;{labels.refreshCwvButton}&rdquo; to query Google PageSpeed Insights v5.
            </p>
          )}

          <div className="flex items-center justify-between text-[11px] text-[var(--fg-subtle)]">
            <span>
              Source:{" "}
              {mobileCwv
                ? `${mobileCwv.source === "psi_lab" ? "PSI Lab" : "CrUX Field"} (${mobileCwv.strategy})`
                : "Not fetched"}
            </span>
            {mobileCwv?.perfScore !== null && mobileCwv?.perfScore !== undefined && (
              <span className="font-mono font-semibold text-[var(--fg)]">
                Perf Score: {mobileCwv.perfScore}/100
              </span>
            )}
          </div>
        </Card>
      </div>

      {/* Top 5 Priority Fixes */}
      {topFixes.length > 0 && (
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[var(--warning)]" />
              <h2 className="text-sm font-semibold text-[var(--fg)]">
                {labels.topFixesTitle}
              </h2>
            </div>
            <Link
              href={`/p/${projectId}/audit`}
              className="text-xs font-medium text-[var(--brand)] hover:underline"
            >
              {labels.viewAllIssues} ({openIssues.length})
            </Link>
          </div>

          <div className="divide-y divide-[var(--border)]">
            {topFixes.map((issue) => (
              <div
                key={issue.id}
                className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-center"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge
                      severity={issue.severity}
                      label={issue.severity.toUpperCase()}
                    />
                    <span className="font-mono text-xs text-[var(--fg-subtle)]">
                      {issue.ruleId}
                    </span>
                    <Link
                      href={`/p/${projectId}/audit/${issue.id}`}
                      className="text-sm font-semibold text-[var(--fg)] hover:text-[var(--brand)]"
                    >
                      {issue.finding.title}
                    </Link>
                  </div>
                  <p className="text-xs text-[var(--fg-muted)]">
                    {issue.finding.why_it_matters}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="neutral">
                    {issue.affectedCount} URL{issue.affectedCount === 1 ? "" : "s"}
                  </Badge>
                  <Link href={`/p/${projectId}/audit/${issue.id}`}>
                    <Button size="sm" variant="secondary">
                      View Exact Fix
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {crawl?.status === "completed" && topFixes.length === 0 && (
        <Card className="flex items-center gap-3 p-4">
          <CheckCircle2 className="h-5 w-5 text-[var(--good)]" />
          <p className="text-sm font-medium text-[var(--fg)]">
            Zero open audit issues detected in the latest crawl.
          </p>
        </Card>
      )}
    </div>
  );
}
