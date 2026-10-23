"use client";

import * as React from "react";
import {
  CheckCircle2,
  Compass,
  Layers,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import type {
  KeywordClusterDto,
  KeywordRowDto,
  ProjectKeywordsOverview,
} from "@/lib/keywords/service";

export interface KeywordsClientProps {
  projectId: string;
  initialOverview: ProjectKeywordsOverview;
}

export function KeywordsClient({
  projectId,
  initialOverview,
}: KeywordsClientProps) {
  const [overview, setOverview] = React.useState<ProjectKeywordsOverview>(initialOverview);
  const [seedInput, setSeedInput] = React.useState("");
  const [selectedClusterId, setSelectedClusterId] = React.useState<string>("all");
  const [intentFilter, setIntentFilter] = React.useState<string>("all");
  const [onlyTracked, setOnlyTracked] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedKeywordId, setExpandedKeywordId] = React.useState<string | null>(null);

  async function handleRunResearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const seeds = seedInput
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length >= 2);

      const res = await fetch(`/api/v1/projects/${projectId}/keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seedKeywords: seeds.length > 0 ? seeds : undefined,
          autoTrackTop: true,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: ProjectKeywordsOverview;
        error?: { message?: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "Failed to run keyword research");
      }
      setOverview(json.data);
      setSeedInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to expand keywords");
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleTrack(kw: KeywordRowDto) {
    try {
      const res = await fetch(`/api/v1/keywords/${kw.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tracked: !kw.tracked }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { id: string; tracked: boolean };
      };
      if (res.ok && json.ok && json.data) {
        setOverview((prev) => ({
          ...prev,
          keywords: prev.keywords.map((item) =>
            item.id === kw.id ? { ...item, tracked: json.data!.tracked } : item,
          ),
        }));
      }
    } catch {
      // Ignore transient toggle error
    }
  }

  const filteredKeywords = overview.keywords.filter((kw) => {
    if (selectedClusterId !== "all" && kw.clusterId !== selectedClusterId) {
      return false;
    }
    if (intentFilter !== "all" && kw.intent !== intentFilter) {
      return false;
    }
    if (onlyTracked && !kw.tracked) {
      return false;
    }
    return true;
  });

  function renderIntentBadge(intent: KeywordRowDto["intent"], confidence: number | null) {
    if (!intent) return <Badge variant="neutral">unclassified</Badge>;
    const variant =
      intent === "transactional"
        ? "good"
        : intent === "commercial"
          ? "brand"
          : intent === "informational"
            ? "info"
            : "neutral";
    const pct = confidence ? ` ${Math.round(confidence * 100)}%` : "";
    return (
      <Badge variant={variant}>
        {intent}
        {pct}
      </Badge>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--fg)]">
            Keyword Research, Topic Clusters &amp; Rank Tracker
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            Expand seeds with Search Console queries &amp; crawled page topics, group by semantic intent, and track ranking positions over time.
          </p>
        </div>
      </div>

      {/* Honest Volume Policy Notice (§4.1) */}
      <div className="rounded-[10px] border border-[var(--brand)]/30 bg-[var(--brand-subtle)]/40 px-4 py-3 text-xs leading-relaxed text-[var(--fg)]">
        <strong className="font-semibold text-[var(--brand)]">
          Evidence-First Volume Policy:
        </strong>{" "}
        {overview.honestPolicyNotice}
      </div>

      {/* Seed Expansion Bar */}
      <Card className="space-y-3">
        <form
          onSubmit={handleRunResearch}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1 space-y-1.5">
            <label
              htmlFor="seed-keywords-input"
              className="block text-xs font-semibold text-[var(--fg)]"
            >
              Seed Keywords (comma-separated, or leave blank to auto-expand from Search Console &amp; crawled pages)
            </label>
            <input
              id="seed-keywords-input"
              type="text"
              value={seedInput}
              onChange={(e) => setSeedInput(e.target.value)}
              placeholder="e.g. technical seo audit, core web vitals, nextjs seo checklist"
              className="h-10 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--fg)] placeholder:text-[var(--fg-subtle)] focus:border-[var(--brand)] focus:outline-none"
            />
          </div>
          <Button type="submit" disabled={loading}>
            <Sparkles className="h-4 w-4" />
            {loading ? "Expanding & Clustering..." : "Expand & Cluster Keywords"}
          </Button>
        </form>
        {error && <p className="text-xs text-[var(--crit)]">{error}</p>}
      </Card>

      {/* Topic Clusters Grid */}
      {overview.clusters.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-[var(--brand)]" />
              <h2 className="text-base font-semibold text-[var(--fg)]">
                Topic Clusters ({overview.clusters.length})
              </h2>
            </div>
            {selectedClusterId !== "all" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setSelectedClusterId("all")}
              >
                Show All Clusters
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {overview.clusters.map((cluster: KeywordClusterDto) => {
              const active = selectedClusterId === cluster.id;
              return (
                <button
                  key={cluster.id}
                  type="button"
                  onClick={() =>
                    setSelectedClusterId(active ? "all" : cluster.id)
                  }
                  className={`rounded-[10px] border p-3.5 text-left transition ${
                    active
                      ? "border-[var(--brand)] bg-[var(--brand-subtle)]/30"
                      : "border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--brand)]/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-[var(--fg)]">
                      {cluster.name}
                    </span>
                    <Badge variant="brand">P{cluster.priority}</Badge>
                  </div>
                  <p className="mt-1 font-mono text-xs text-[var(--fg-muted)]">
                    Pillar: {cluster.pillarKeyword ?? "—"}
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-[var(--fg-subtle)]">
                    <Badge variant="neutral">{cluster.keywordsCount} keywords</Badge>
                    {cluster.intent && (
                      <Badge variant="info">{cluster.intent}</Badge>
                    )}
                    {cluster.totalImpressions28d > 0 && (
                      <span className="font-mono">
                        {cluster.totalImpressions28d.toLocaleString()} GSC impr
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Keywords & Rank Tracker Table */}
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-[var(--brand)]" />
            <h2 className="text-base font-semibold text-[var(--fg)]">
              Keywords &amp; Rank Tracker ({filteredKeywords.length})
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              aria-label="Filter by search intent"
              value={intentFilter}
              onChange={(e) => setIntentFilter(e.target.value)}
              className="h-8 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--fg)]"
            >
              <option value="all">All Intents</option>
              <option value="informational">Informational</option>
              <option value="commercial">Commercial</option>
              <option value="transactional">Transactional</option>
              <option value="navigational">Navigational</option>
            </select>

            <button
              type="button"
              onClick={() => setOnlyTracked((v) => !v)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-[6px] border px-2.5 font-medium ${
                onlyTracked
                  ? "border-[var(--brand)] bg-[var(--brand-subtle)] text-[var(--brand)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--fg-muted)]"
              }`}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              Tracked Only
            </button>
          </div>
        </div>

        {filteredKeywords.length === 0 ? (
          <div className="py-10 text-center text-sm text-[var(--fg-muted)]">
            No keywords researched yet. Click{" "}
            <strong className="text-[var(--fg)]">Expand &amp; Cluster Keywords</strong>{" "}
            above to seed from Search Console, crawled pages, or custom topics.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--fg-muted)]">
                  <th className="py-2.5 pr-3 font-semibold">Keyword &amp; Cluster</th>
                  <th className="px-3 py-2.5 font-semibold">Intent</th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    Demand (Vol / 28d Impr)
                  </th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    Difficulty (Est.)
                  </th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    Avg Position
                  </th>
                  <th className="px-3 py-2.5 text-right font-semibold">
                    Priority
                  </th>
                  <th className="py-2.5 pl-3 text-right font-semibold">
                    Tracked
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredKeywords.map((kw) => {
                  const isExpanded = expandedKeywordId === kw.id;
                  return (
                    <React.Fragment key={kw.id}>
                      <tr className="hover:bg-[var(--surface)]/60">
                        <td className="py-3 pr-3">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedKeywordId(isExpanded ? null : kw.id)
                            }
                            className="font-mono font-semibold text-[var(--fg)] hover:text-[var(--brand)]"
                          >
                            {kw.keyword}
                          </button>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--fg-subtle)]">
                            {kw.clusterName && <span>{kw.clusterName}</span>}
                            {kw.sources.map((src) => (
                              <span
                                key={src}
                                className="rounded bg-[var(--surface)] px-1.5 py-0.2 font-mono text-[10px]"
                              >
                                {src}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          {renderIntentBadge(kw.intent, kw.intentConfidence)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono">
                          {kw.volume !== null ? (
                            <div>
                              <span className="font-semibold text-[var(--fg)]">
                                {kw.volume.toLocaleString()}/mo
                              </span>
                              <span className="block text-[10px] text-[var(--fg-subtle)]">
                                {kw.volumeSource ?? "provider"}
                              </span>
                            </div>
                          ) : kw.gscImpressions28d !== null ? (
                            <div>
                              <span className="font-semibold text-[var(--fg)]">
                                {kw.gscImpressions28d.toLocaleString()} impr
                              </span>
                              <span className="block text-[10px] text-[var(--good)]">
                                GSC 28d measured
                              </span>
                            </div>
                          ) : (
                            <span className="text-[var(--fg-subtle)]">
                              — (No volume API)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-mono">
                          {kw.difficultyEst !== null ? (
                            <div>
                              <span className="font-semibold text-[var(--fg)]">
                                ~{Math.round(kw.difficultyEst)}/100
                              </span>
                              <span className="block text-[10px] text-[var(--warn)]">
                                Est. ({Math.round((kw.difficultyConfidence ?? 0.45) * 100)}% conf)
                              </span>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-mono">
                          {kw.gscPosition !== null ? (
                            <Badge
                              variant={
                                kw.gscPosition <= 10
                                  ? "good"
                                  : kw.gscPosition <= 20
                                    ? "warning"
                                    : "neutral"
                              }
                            >
                              #{kw.gscPosition.toFixed(1)}
                            </Badge>
                          ) : (
                            <span className="text-[var(--fg-subtle)]">Unranked</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-bold text-[var(--brand)]">
                          {kw.priority}
                        </td>
                        <td className="py-3 pl-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleToggleTrack(kw)}
                            className={`inline-flex items-center gap-1 rounded-[6px] border px-2 py-1 text-[11px] font-medium ${
                              kw.tracked
                                ? "border-[var(--good)]/40 bg-[var(--good-subtle)] text-[var(--good)]"
                                : "border-[var(--border)] bg-[var(--surface)] text-[var(--fg-muted)]"
                            }`}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            {kw.tracked ? "Tracked" : "Track"}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-[var(--surface)]/80">
                          <td colSpan={7} className="px-4 py-3">
                            <div className="space-y-2">
                              <p className="text-xs font-semibold text-[var(--fg)]">
                                Rank History Series for &ldquo;{kw.keyword}&rdquo;
                              </p>
                              {kw.rankHistory.length === 0 ? (
                                <p className="text-xs text-[var(--fg-muted)]">
                                  No daily rank history checkpoints recorded yet. Sync Google Search Console on the Dashboard to populate daily position trends.
                                </p>
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  {kw.rankHistory.map((pt) => (
                                    <div
                                      key={`${pt.date}-${pt.source}`}
                                      className="rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 font-mono text-[11px]"
                                    >
                                      <span className="text-[var(--fg-muted)]">
                                        {pt.date}:
                                      </span>{" "}
                                      <strong className="text-[var(--fg)]">
                                        #{pt.position ?? "—"}
                                      </strong>{" "}
                                      <span className="text-[10px] text-[var(--fg-subtle)]">
                                        ({pt.source})
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
