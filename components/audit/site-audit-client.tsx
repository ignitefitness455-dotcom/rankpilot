"use client";

import * as React from "react";
import {
  CheckCircle2,
  EyeOff,
  Filter,
  GitCompare,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { Link, useRouter } from "@/lib/i18n/routing";
import { Badge, Button, Card, Select, SeverityBadge } from "@/components/ui/primitives";
import type { CrawlSummaryRow, IssueSummaryRow } from "./dashboard-audit-panel";

export interface SiteAuditClientProps {
  projectId: string;
  isVerified: boolean;
  initialCrawls: CrawlSummaryRow[];
  initialIssues: IssueSummaryRow[];
  comparison: {
    scoreDelta: number | null;
    newIssuesCount: number;
    fixedIssuesCount: number;
    regressedIssuesCount: number;
  };
}

const CATEGORIES = [
  { id: "all", label: "All Categories" },
  { id: "technical", label: "Technical" },
  { id: "on_page", label: "On-Page" },
  { id: "content", label: "Content" },
  { id: "links", label: "Internal Links" },
  { id: "performance", label: "Performance" },
  { id: "ai_search", label: "AI Search / GEO" },
] as const;

export function SiteAuditClient({
  projectId,
  isVerified,
  initialCrawls,
  initialIssues,
  comparison,
}: SiteAuditClientProps) {
  const router = useRouter();
  const [crawls, setCrawls] = React.useState<CrawlSummaryRow[]>(initialCrawls);
  const [issues, setIssues] = React.useState<IssueSummaryRow[]>(initialIssues);
  const [categoryFilter, setCategoryFilter] = React.useState<string>("all");
  const [severityFilter, setSeverityFilter] = React.useState<string>("all");
  const [statusFilter, setStatusFilter] = React.useState<string>("open");
  const [starting, setStarting] = React.useState(false);

  const latestCrawl = crawls[0] ?? null;
  const latestCrawlId = latestCrawl?.id;
  const isRunning =
    latestCrawl?.status === "queued" || latestCrawl?.status === "running";

  React.useEffect(() => {
    if (!latestCrawlId || !isRunning) return;
    const es = new EventSource(`/api/v1/crawls/${latestCrawlId}/events`);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setCrawls((prev) =>
          prev.map((c, idx) =>
            idx === 0
              ? {
                  ...c,
                  status: data.status,
                  pagesFound: data.pagesFound,
                  pagesCrawled: data.pagesCrawled,
                  progress: data.progress,
                  healthScore: data.healthScore ?? c.healthScore,
                  error: data.error ?? c.error,
                }
              : c,
          ),
        );
        if (
          data.status === "completed" ||
          data.status === "failed" ||
          data.status === "cancelled"
        ) {
          es.close();
          router.refresh();
        }
      } catch {
        // ignore
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [latestCrawlId, isRunning, router]);

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
        throw new Error(json?.error?.message || "Could not start crawl");
      }
      const newCrawl = json.data.crawl;
      setCrawls((prev) => [
        {
          ...newCrawl,
          createdAt: newCrawl.createdAt ?? new Date().toISOString(),
          finishedAt: newCrawl.finishedAt ?? null,
        },
        ...prev.filter((c) => c.id !== newCrawl.id),
      ]);
      toast.info(
        isVerified
          ? "Site Audit crawl started"
          : "Site Audit started (50-page unverified cap active)",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start crawl");
    } finally {
      setStarting(false);
    }
  };

  const handleCancelCrawl = async () => {
    if (!latestCrawl) return;
    const res = await fetch(`/api/v1/crawls/${latestCrawl.id}/cancel`, {
      method: "POST",
    });
    if (res.ok) {
      toast.info("Crawl cancelled");
      router.refresh();
    }
  };

  const handleQuickStatusUpdate = async (
    issueId: string,
    nextStatus: "open" | "fixed" | "ignored",
  ) => {
    try {
      const res = await fetch(`/api/v1/issues/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: nextStatus,
          ignoredReason:
            nextStatus === "ignored" ? "Dismissed from Site Audit list" : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error?.message || "Failed to update issue status");
      }
      setIssues((prev) =>
        prev.map((i) => (i.id === issueId ? { ...i, status: nextStatus } : i)),
      );
      toast.success(`Issue marked as ${nextStatus}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update issue");
    }
  };

  const filteredIssues = issues.filter((issue) => {
    if (categoryFilter !== "all" && issue.category !== categoryFilter) {
      return false;
    }
    if (severityFilter !== "all" && issue.severity !== severityFilter) {
      return false;
    }
    if (statusFilter === "open") {
      return issue.status === "open" || issue.status === "regressed";
    }
    if (statusFilter !== "all" && issue.status !== statusFilter) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header + Start Crawl CTA */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--fg)]">
            Technical &amp; On-Page Site Audit
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            Deterministic 40-rule SEO, Link Graph, Core Web Vitals, and AI Search readiness engine. Every finding carries verifiable evidence and an exact copy-paste fix.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href={`/p/${projectId}/pages`}>
            <Button variant="secondary" size="sm">
              Crawled Pages ({latestCrawl?.pagesCrawled ?? 0})
            </Button>
          </Link>
          {isRunning ? (
            <Button
              variant="danger"
              size="sm"
              onClick={handleCancelCrawl}
              data-testid="audit-cancel-crawl-btn"
            >
              <Square className="h-3.5 w-3.5" />
              Cancel Crawl ({Math.round(latestCrawl?.progress ?? 0)}%)
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleStartCrawl}
              disabled={starting}
              data-testid="audit-start-crawl-btn"
            >
              <Play className="h-3.5 w-3.5" />
              {starting ? "Starting..." : "Run New Crawl"}
            </Button>
          )}
        </div>
      </div>

      {/* Live Crawl Progress Bar */}
      {isRunning && latestCrawl && (
        <Card className="space-y-2 border-[var(--brand)]">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[var(--fg)]">
              Crawling project ({latestCrawl.pagesCrawled} / {latestCrawl.pagesFound} discovered URLs)...
            </span>
            <span className="font-mono font-bold text-[var(--brand)]">
              {Math.round(latestCrawl.progress)}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full bg-[var(--brand)] transition-all duration-300"
              style={{ width: `${Math.max(5, latestCrawl.progress)}%` }}
            />
          </div>
        </Card>
      )}

      {/* Summary KPI Cards + Crawl Diff */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="p-4">
          <p className="text-xs font-medium text-[var(--fg-muted)]">Health Score</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              data-testid="audit-health-score"
              className="font-mono text-2xl font-bold tabular-nums text-[var(--fg)]"
            >
              {latestCrawl?.healthScore ?? "—"}
              <span className="text-xs text-[var(--fg-subtle)]">/100</span>
            </span>
            {comparison.scoreDelta !== null && comparison.scoreDelta !== 0 && (
              <Badge variant={comparison.scoreDelta > 0 ? "good" : "critical"}>
                {comparison.scoreDelta > 0
                  ? `+${comparison.scoreDelta}`
                  : `${comparison.scoreDelta}`}
              </Badge>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium text-[var(--fg-muted)]">Critical Issues</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--critical)]">
            {
              issues.filter(
                (i) =>
                  i.severity === "critical" &&
                  (i.status === "open" || i.status === "regressed"),
              ).length
            }
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium text-[var(--fg-muted)]">Warnings</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--warning)]">
            {
              issues.filter(
                (i) =>
                  i.severity === "warning" &&
                  (i.status === "open" || i.status === "regressed"),
              ).length
            }
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs font-medium text-[var(--fg-muted)]">Fixed Since Last Crawl</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--good)]">
            {comparison.fixedIssuesCount}
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-[var(--fg-muted)]">Regressed</p>
            <GitCompare className="h-3.5 w-3.5 text-[var(--fg-subtle)]" />
          </div>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--fg)]">
            {comparison.regressedIssuesCount}
          </p>
        </Card>
      </div>

      {/* Category Pills & Severity/Status Filters */}
      <Card className="flex flex-col justify-between gap-4 p-4 lg:flex-row lg:items-center">
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORIES.map((cat) => {
            const active = categoryFilter === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryFilter(cat.id)}
                className={`rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-[var(--brand)] text-white"
                    : "bg-[var(--surface-2)] text-[var(--fg-muted)] hover:text-[var(--fg)]"
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-[var(--fg-subtle)]" />
          <Select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="w-36 text-xs"
            aria-label="Filter by severity"
          >
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </Select>

          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-40 text-xs"
            aria-label="Filter by lifecycle status"
          >
            <option value="open">Open &amp; Regressed</option>
            <option value="regressed">Regressed Only</option>
            <option value="fixed">Fixed</option>
            <option value="ignored">Ignored</option>
            <option value="all">All Statuses</option>
          </Select>
        </div>
      </Card>

      {/* Issues List */}
      <div className="space-y-3" data-testid="audit-issues-list">
        {filteredIssues.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-sm font-medium text-[var(--fg)]">
              {crawls.length === 0
                ? "No site audit crawl has been run yet. Click 'Run New Crawl' above to audit your site."
                : "No findings match the current filter criteria."}
            </p>
          </Card>
        ) : (
          filteredIssues.map((issue) => (
            <Card key={issue.id} className="space-y-3 p-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge
                      severity={issue.severity}
                      label={issue.severity.toUpperCase()}
                    />
                    {issue.status === "regressed" && (
                      <Badge variant="critical">REGRESSED</Badge>
                    )}
                    {issue.status === "fixed" && (
                      <Badge variant="good">FIXED</Badge>
                    )}
                    {issue.status === "ignored" && (
                      <Badge variant="neutral">IGNORED</Badge>
                    )}
                    <Badge variant="neutral">{issue.category}</Badge>
                    <span className="font-mono text-xs text-[var(--fg-subtle)]">
                      {issue.ruleId}
                    </span>
                  </div>

                  <Link
                    href={`/p/${projectId}/audit/${issue.id}`}
                    className="block text-base font-semibold text-[var(--fg)] hover:text-[var(--brand)]"
                  >
                    {issue.finding.title}
                  </Link>
                  <p className="text-xs leading-relaxed text-[var(--fg-muted)]">
                    <strong className="text-[var(--fg)]">Why it matters:</strong>{" "}
                    {issue.finding.why_it_matters}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Badge variant="info">
                    {issue.affectedCount} affected URL{issue.affectedCount === 1 ? "" : "s"}
                  </Badge>
                  <Badge variant="neutral">
                    Impact {issue.finding.impact}/5 · Effort {issue.finding.effort}/5
                  </Badge>
                  <Link href={`/p/${projectId}/audit/${issue.id}`}>
                    <Button size="sm">View Exact Fix</Button>
                  </Link>
                  {issue.status !== "fixed" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleQuickStatusUpdate(issue.id, "fixed")}
                      title="Mark Fixed"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {issue.status !== "ignored" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleQuickStatusUpdate(issue.id, "ignored")}
                      title="Ignore rule"
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleQuickStatusUpdate(issue.id, "open")}
                      title="Re-open issue"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Sample evidence preview */}
              {issue.finding.evidence[0] && (
                <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 font-mono text-xs text-[var(--fg-muted)]">
                  <span className="font-semibold text-[var(--fg)]">
                    {issue.finding.evidence[0].url}
                  </span>{" "}
                  — {issue.finding.evidence[0].observed}
                </div>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
