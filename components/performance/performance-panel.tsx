"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  GitFork,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
  TrendingDown,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Card, SeverityBadge } from "@/components/ui/primitives";
import type { PerformanceIntelligenceReport } from "@/lib/performance/intelligence";

type PerfTab = "quickWins" | "ctrGaps" | "decay" | "cannibalization" | "winnersLosers";

export function PerformanceIntelligencePanel({
  projectId,
  initialReport,
  oauthConnected,
}: {
  projectId: string;
  initialReport: PerformanceIntelligenceReport;
  oauthConnected: boolean;
}) {
  const [report, setReport] = React.useState<PerformanceIntelligenceReport>(initialReport);
  const [activeTab, setActiveTab] = React.useState<PerfTab>("quickWins");
  const [syncing, setSyncing] = React.useState(false);

  const handleSyncGsc = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/gsc/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days: 56 }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: {
          sync: { mode: "google_oauth" | "demo_seed"; rowsUpserted: number };
          intelligence: PerformanceIntelligenceReport;
        };
        error?: { message?: string };
      };
      if (!json.ok || !json.data) {
        toast.error(json.error?.message ?? "Failed to sync Search Console data");
        return;
      }
      setReport(json.data.intelligence);
      toast.success(
        json.data.sync.mode === "google_oauth"
          ? `Synced ${json.data.sync.rowsUpserted} Search Console rows via Google OAuth`
          : `Loaded ${json.data.sync.rowsUpserted} Search Console rows (sample telemetry mode)`,
      );
    } catch {
      toast.error("Failed to sync Search Console");
    } finally {
      setSyncing(false);
    }
  };

  const ov = report.overview;

  return (
    <Card className="space-y-4" data-testid="performance-intelligence-panel">
      {/* Header */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--fg)]">
              <BarChart3 className="h-4 w-4 text-[var(--brand)]" />
              <span>Performance Intelligence (Search Console & GA4)</span>
            </h2>
            {oauthConnected || report.dataSource === "google_oauth" ? (
              <Badge variant="good">Google OAuth Live</Badge>
            ) : report.hasData ? (
              <Badge variant="warning">Sample Telemetry (Demo Mode)</Badge>
            ) : (
              <Badge variant="neutral">Not Synced Yet</Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
            Deterministic analysis of Quick Wins (positions 4–20), CTR gaps, content decay,
            keyword cannibalization, and daily traffic anomalies.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleSyncGsc()}
            disabled={syncing}
            data-testid="sync-gsc-button"
          >
            {syncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span>{report.hasData ? "Sync Search Console" : "Load Search Console Data"}</span>
          </Button>
        </div>
      </div>

      {!report.hasData ? (
        <div className="rounded-[10px] border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-6 text-center">
          <p className="text-sm font-medium text-[var(--fg)]">
            No Search Console performance rows loaded yet
          </p>
          <p className="mx-auto mt-1 max-w-lg text-xs text-[var(--fg-muted)]">
            Click &ldquo;Load Search Console Data&rdquo; above to sync via read-only Google OAuth
            (or seed realistic sample telemetry if Google OAuth is not configured in local dev).
          </p>
        </div>
      ) : (
        <>
          {/* 4 KPI cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3.5">
              <p className="text-xs font-medium text-[var(--fg-muted)]">28-Day Organic Clicks</p>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="font-mono text-xl font-bold tabular-nums text-[var(--fg)]">
                  {ov.currentClicks.toLocaleString()}
                </span>
                <span
                  className={`inline-flex items-center gap-0.5 font-mono text-xs font-medium tabular-nums ${
                    ov.clicksDeltaPct >= 0 ? "text-[var(--good)]" : "text-[var(--critical)]"
                  }`}
                >
                  {ov.clicksDeltaPct >= 0 ? (
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowDownRight className="h-3.5 w-3.5" />
                  )}
                  {ov.clicksDeltaPct >= 0 ? `+${ov.clicksDeltaPct}%` : `${ov.clicksDeltaPct}%`}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">
                Prev 28d: {ov.previousClicks.toLocaleString()}
              </p>
            </div>

            <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3.5">
              <p className="text-xs font-medium text-[var(--fg-muted)]">28-Day Impressions</p>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="font-mono text-xl font-bold tabular-nums text-[var(--fg)]">
                  {ov.currentImpressions.toLocaleString()}
                </span>
                <span
                  className={`inline-flex items-center gap-0.5 font-mono text-xs font-medium tabular-nums ${
                    ov.impressionsDeltaPct >= 0 ? "text-[var(--good)]" : "text-[var(--critical)]"
                  }`}
                >
                  {ov.impressionsDeltaPct >= 0 ? (
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowDownRight className="h-3.5 w-3.5" />
                  )}
                  {ov.impressionsDeltaPct >= 0
                    ? `+${ov.impressionsDeltaPct}%`
                    : `${ov.impressionsDeltaPct}%`}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">
                Prev 28d: {ov.previousImpressions.toLocaleString()}
              </p>
            </div>

            <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3.5">
              <p className="text-xs font-medium text-[var(--fg-muted)]">Average CTR</p>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="font-mono text-xl font-bold tabular-nums text-[var(--fg)]">
                  {(ov.currentCtr * 100).toFixed(2)}%
                </span>
                <span className="font-mono text-xs text-[var(--fg-subtle)] tabular-nums">
                  Prev: {(ov.previousCtr * 100).toFixed(2)}%
                </span>
              </div>
              <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">
                {report.ctrGaps.length} CTR gap opportunities detected
              </p>
            </div>

            <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3.5">
              <p className="text-xs font-medium text-[var(--fg-muted)]">Avg Position (Weighted)</p>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="font-mono text-xl font-bold tabular-nums text-[var(--fg)]">
                  #{ov.currentPosition.toFixed(1)}
                </span>
                <span className="font-mono text-xs text-[var(--fg-subtle)] tabular-nums">
                  Prev: #{ov.previousPosition.toFixed(1)}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-[var(--fg-subtle)]">
                {report.quickWins.length} quick wins in pos 4–20
              </p>
            </div>
          </div>

          {/* Tab selector */}
          <div className="flex flex-wrap gap-1.5 border-b border-[var(--border)] pb-2">
            <button
              type="button"
              onClick={() => setActiveTab("quickWins")}
              className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "quickWins"
                  ? "bg-[var(--brand-subtle)] text-[var(--brand)]"
                  : "text-[var(--fg-muted)] hover:bg-[var(--surface-muted)]"
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              <span>Quick Wins ({report.quickWins.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("ctrGaps")}
              className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "ctrGaps"
                  ? "bg-[var(--brand-subtle)] text-[var(--brand)]"
                  : "text-[var(--fg-muted)] hover:bg-[var(--surface-muted)]"
              }`}
            >
              <Target className="h-3.5 w-3.5" />
              <span>CTR Gaps ({report.ctrGaps.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("decay")}
              className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "decay"
                  ? "bg-[var(--brand-subtle)] text-[var(--brand)]"
                  : "text-[var(--fg-muted)] hover:bg-[var(--surface-muted)]"
              }`}
            >
              <TrendingDown className="h-3.5 w-3.5" />
              <span>Content Decay ({report.decay.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("cannibalization")}
              className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "cannibalization"
                  ? "bg-[var(--brand-subtle)] text-[var(--brand)]"
                  : "text-[var(--fg-muted)] hover:bg-[var(--surface-muted)]"
              }`}
            >
              <GitFork className="h-3.5 w-3.5" />
              <span>Cannibalization ({report.cannibalization.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("winnersLosers")}
              className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === "winnersLosers"
                  ? "bg-[var(--brand-subtle)] text-[var(--brand)]"
                  : "text-[var(--fg-muted)] hover:bg-[var(--surface-muted)]"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Winners & Losers</span>
            </button>
          </div>

          {/* Tab Panels */}
          {activeTab === "quickWins" && (
            <div className="space-y-2.5">
              {report.quickWins.length === 0 ? (
                <p className="text-xs text-[var(--fg-muted)]">
                  No queries currently in positions 4–20 above the impression threshold.
                </p>
              ) : (
                report.quickWins.map((qw) => (
                  <div
                    key={`${qw.query}-${qw.page}`}
                    className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-semibold text-[var(--fg)]">
                          &ldquo;{qw.query}&rdquo;
                        </span>
                        <span className="ms-2 font-mono text-[11px] text-[var(--fg-muted)]">
                          {qw.page}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
                        <Badge variant="info">Pos #{qw.position}</Badge>
                        <Badge variant="neutral">{qw.impressions.toLocaleString()} impr</Badge>
                        <Badge variant="good">+{qw.potentialAdditionalClicks} est. clicks</Badge>
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs text-[var(--fg-muted)]">{qw.whyItMatters}</p>
                    <p className="mt-1 text-xs font-medium text-[var(--fg)]">
                      Fix: {qw.recommendedAction}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "ctrGaps" && (
            <div className="space-y-2.5">
              {report.ctrGaps.length === 0 ? (
                <p className="text-xs text-[var(--fg-muted)]">
                  All high-impression queries are performing at or above expected position CTR.
                </p>
              ) : (
                report.ctrGaps.map((gap) => (
                  <div
                    key={`${gap.query}-${gap.page}`}
                    className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-semibold text-[var(--fg)]">
                          &ldquo;{gap.query}&rdquo;
                        </span>
                        <span className="ms-2 font-mono text-[11px] text-[var(--fg-muted)]">
                          Pos #{gap.position} • {gap.page}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
                        <Badge variant="warning">
                          Actual {(gap.actualCtr * 100).toFixed(1)}% vs Exp{" "}
                          {(gap.expectedCtr * 100).toFixed(1)}%
                        </Badge>
                        <Badge variant="brand">+{gap.missedClicksEstimate} missed clicks</Badge>
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs text-[var(--fg-muted)]">{gap.recommendedFix}</p>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "decay" && (
            <div className="space-y-2.5">
              {report.decay.length === 0 ? (
                <p className="text-xs text-[var(--fg-muted)]">
                  No pages lost ≥ 30% organic clicks over the last 28 days.
                </p>
              ) : (
                report.decay.map((item) => (
                  <div
                    key={item.page}
                    className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-[var(--fg)]">
                        {item.page}
                      </span>
                      <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
                        <SeverityBadge
                          severity={item.severity}
                          label={`-${item.dropPct}% clicks (${item.previousClicks} → ${item.currentClicks})`}
                        />
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs text-[var(--fg-muted)]">{item.recommendedFix}</p>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "cannibalization" && (
            <div className="space-y-2.5">
              {report.cannibalization.length === 0 ? (
                <p className="text-xs text-[var(--fg-muted)]">
                  No multi-URL keyword cannibalization detected.
                </p>
              ) : (
                report.cannibalization.map((item) => (
                  <div
                    key={item.query}
                    className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--fg)]">
                        Query: &ldquo;{item.query}&rdquo;
                      </span>
                      <Badge variant="warning">
                        {item.competingPages.length} URLs splitting{" "}
                        {item.totalImpressions.toLocaleString()} impr
                      </Badge>
                    </div>
                    <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                      {item.competingPages.map((cp) => (
                        <div
                          key={cp.page}
                          className="rounded-[6px] border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1.5 font-mono text-[11px]"
                        >
                          <div className="truncate font-semibold text-[var(--fg)]">{cp.page}</div>
                          <div className="text-[var(--fg-muted)]">
                            {cp.impressionSharePct}% share • Pos #{cp.avgPosition} • {cp.clicks}{" "}
                            clicks
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-[var(--fg-muted)]">{item.recommendedFix}</p>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "winnersLosers" && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3">
                <h3 className="text-xs font-semibold text-[var(--good)]">
                  Top Gaining Queries (28d vs Prev 28d)
                </h3>
                {report.winners.map((w) => (
                  <div
                    key={`win-${w.query}-${w.page}`}
                    className="flex items-center justify-between border-b border-[var(--border)] pb-1.5 text-xs last:border-0"
                  >
                    <div className="truncate pe-2">
                      <span className="font-medium text-[var(--fg)]">{w.query}</span>
                      <span className="ms-1.5 font-mono text-[10px] text-[var(--fg-subtle)]">
                        (#{w.currentPosition})
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-xs font-semibold text-[var(--good)] tabular-nums">
                      +{w.deltaClicks} clicks
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3">
                <h3 className="text-xs font-semibold text-[var(--critical)]">
                  Top Declining Queries (28d vs Prev 28d)
                </h3>
                {report.losers.map((l) => (
                  <div
                    key={`lose-${l.query}-${l.page}`}
                    className="flex items-center justify-between border-b border-[var(--border)] pb-1.5 text-xs last:border-0"
                  >
                    <div className="truncate pe-2">
                      <span className="font-medium text-[var(--fg)]">{l.query}</span>
                      <span className="ms-1.5 font-mono text-[10px] text-[var(--fg-subtle)]">
                        (#{l.currentPosition})
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-xs font-semibold text-[var(--critical)] tabular-nums">
                      {l.deltaClicks} clicks
                    </span>
                  </div>
                ))}
              </div>

              {report.anomalies.length > 0 && (
                <div className="md:col-span-2 space-y-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--warning)]">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>Statistical Traffic Anomalies (|z| ≥ 2.5)</span>
                  </h3>
                  {report.anomalies.map((a) => (
                    <p key={a.date} className="text-xs text-[var(--fg-muted)]">
                      • {a.title}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
