"use client";

import * as React from "react";
import {
  Globe,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import type {
  CompetitorDto,
  SerpGapAnalysisReport,
} from "@/lib/competitors/service";

export interface CompetitorsClientProps {
  projectId: string;
  initialCompetitors: CompetitorDto[];
}

export function CompetitorsClient({
  projectId,
  initialCompetitors,
}: CompetitorsClientProps) {
  const [competitors, setCompetitors] =
    React.useState<CompetitorDto[]>(initialCompetitors);
  const [hostInput, setHostInput] = React.useState("");
  const [nameInput, setNameInput] = React.useState("");
  const [addingCompetitor, setAddingCompetitor] = React.useState(false);

  const [queryInput, setQueryInput] = React.useState("technical seo audit checklist");
  const [competitorUrlsInput, setCompetitorUrlsInput] = React.useState("");
  const [analyzing, setAnalyzing] = React.useState(false);
  const [report, setReport] = React.useState<SerpGapAnalysisReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleAddCompetitor(e: React.FormEvent) {
    e.preventDefault();
    if (!hostInput.trim()) return;
    setAddingCompetitor(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/competitors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostOrUrl: hostInput.trim(),
          name: nameInput.trim() || undefined,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { competitor: CompetitorDto };
        error?: { message?: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "Failed to add competitor");
      }
      setCompetitors((prev) => [
        json.data!.competitor,
        ...prev.filter((c) => c.id !== json.data!.competitor.id),
      ]);
      setHostInput("");
      setNameInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add competitor");
    } finally {
      setAddingCompetitor(false);
    }
  }

  async function handleRemoveCompetitor(id: string) {
    try {
      const res = await fetch(
        `/api/v1/projects/${projectId}/competitors?competitorId=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setCompetitors((prev) => prev.filter((c) => c.id !== id));
      }
    } catch {
      // Ignore transient error
    }
  }

  async function handleAnalyzeSerp(e: React.FormEvent) {
    e.preventDefault();
    if (!queryInput.trim()) return;
    setAnalyzing(true);
    setError(null);
    try {
      const urls = competitorUrlsInput
        .split(",")
        .map((u) => u.trim())
        .filter((u) => /^https?:\/\//i.test(u));

      const res = await fetch(
        `/api/v1/projects/${projectId}/competitors/analyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: queryInput.trim(),
            competitorUrls: urls.length > 0 ? urls : undefined,
          }),
        },
      );
      const json = (await res.json()) as {
        ok: boolean;
        data?: { report: SerpGapAnalysisReport };
        error?: { message?: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "Failed to analyze SERP gap");
      }
      setReport(json.data.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "SERP analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--fg)]">
          Competitors &amp; SERP Gap Analysis
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          Compare your crawled pages against top-ranking competitor structures, schema types, and entity coverage (&ldquo;What the Top 10 Have That You Don&rsquo;t&rdquo;).
        </p>
      </div>

      {/* Competitor Domain Roster */}
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-[var(--brand)]" />
            <h2 className="text-base font-semibold text-[var(--fg)]">
              Tracked Competitor Domains ({competitors.length})
            </h2>
          </div>
          <Badge variant="neutral">Pluggable SERP API + SSRF-Safe Fetch</Badge>
        </div>

        <form
          onSubmit={handleAddCompetitor}
          className="grid gap-3 sm:grid-cols-3"
        >
          <input
            type="text"
            value={hostInput}
            onChange={(e) => setHostInput(e.target.value)}
            placeholder="Competitor domain (e.g. ahrefs.com)"
            className="h-9 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--fg)] placeholder:text-[var(--fg-subtle)] focus:border-[var(--brand)] focus:outline-none"
          />
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="Display label (optional)"
            className="h-9 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--fg)] placeholder:text-[var(--fg-subtle)] focus:border-[var(--brand)] focus:outline-none"
          />
          <Button type="submit" size="sm" disabled={addingCompetitor}>
            <Plus className="h-3.5 w-3.5" />
            {addingCompetitor ? "Adding..." : "Add Competitor Domain"}
          </Button>
        </form>

        {competitors.length === 0 ? (
          <p className="text-xs text-[var(--fg-muted)]">
            No competitor domains added yet. Add up to 5 competitor domains above to benchmark against your site.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {competitors.map((comp) => (
              <div
                key={comp.id}
                className="inline-flex items-center gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs"
              >
                <span className="font-mono font-semibold text-[var(--fg)]">
                  {comp.host}
                </span>
                {comp.name && comp.name !== comp.host && (
                  <span className="text-[var(--fg-muted)]">({comp.name})</span>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${comp.host}`}
                  onClick={() => handleRemoveCompetitor(comp.id)}
                  className="text-[var(--fg-subtle)] hover:text-[var(--crit)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* SERP & Content Gap Query Box */}
      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-[var(--brand)]" />
          <h2 className="text-base font-semibold text-[var(--fg)]">
            SERP &amp; Content Gap Analyzer
          </h2>
        </div>

        <form onSubmit={handleAnalyzeSerp} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label
                htmlFor="serp-query-input"
                className="block text-xs font-semibold text-[var(--fg)]"
              >
                Target Search Query
              </label>
              <input
                id="serp-query-input"
                type="text"
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="e.g. technical seo audit checklist"
                className="h-10 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--fg)] focus:border-[var(--brand)] focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="comp-urls-input"
                className="block text-xs font-semibold text-[var(--fg)]"
              >
                Optional Live Competitor URLs to Fetch &amp; Parse (comma-separated)
              </label>
              <input
                id="comp-urls-input"
                type="text"
                value={competitorUrlsInput}
                onChange={(e) => setCompetitorUrlsInput(e.target.value)}
                placeholder="https://competitor.com/guide (optional)"
                className="h-10 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--fg)] focus:border-[var(--brand)] focus:outline-none"
              />
            </div>
          </div>

          <Button type="submit" disabled={analyzing}>
            <Sparkles className="h-4 w-4" />
            {analyzing
              ? "Analyzing SERP & Competitor Structures..."
              : "Compare Top Results vs. Your Site"}
          </Button>
        </form>
        {error && <p className="text-xs text-[var(--crit)]">{error}</p>}
      </Card>

      {/* Gap Analysis Output */}
      {report && (
        <div className="space-y-6">
          {/* Summary Metrics: What the Top 10 Have That You Don't */}
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-[var(--fg)]">
                  What the Top Competitors Have That You Don&rsquo;t
                </h2>
                <p className="text-xs text-[var(--fg-muted)]">
                  Query: <strong className="font-mono text-[var(--fg)]">{report.query}</strong> · Intent:{" "}
                  <Badge variant="info">{report.intent}</Badge> · Source:{" "}
                  <Badge variant="brand">{report.providerUsed}</Badge>
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3">
                <span className="text-xs text-[var(--fg-muted)]">
                  Your Word Count vs. Top Avg
                </span>
                <p className="mt-1 font-mono text-lg font-bold text-[var(--fg)]">
                  {report.whatTop10HaveThatYouDont.yourWordCount} /{" "}
                  {report.whatTop10HaveThatYouDont.avgCompetitorWordCount}
                </p>
                <span className="text-[11px] text-[var(--warn)]">
                  Gap: -{report.whatTop10HaveThatYouDont.wordCountGap} words
                </span>
              </div>

              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3">
                <span className="text-xs text-[var(--fg-muted)]">
                  Your H2 Count vs. Top Avg
                </span>
                <p className="mt-1 font-mono text-lg font-bold text-[var(--fg)]">
                  {report.whatTop10HaveThatYouDont.yourH2Count} /{" "}
                  {report.whatTop10HaveThatYouDont.avgCompetitorH2Count} H2s
                </p>
                <span className="text-[11px] text-[var(--fg-subtle)]">
                  Subheading depth comparison
                </span>
              </div>

              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3">
                <span className="text-xs text-[var(--fg-muted)]">
                  Missing Subtopics &amp; Entities
                </span>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {report.whatTop10HaveThatYouDont.missingSubtopics.length === 0 ? (
                    <Badge variant="good">Full Entity Coverage</Badge>
                  ) : (
                    report.whatTop10HaveThatYouDont.missingSubtopics
                      .slice(0, 5)
                      .map((sub) => (
                        <Badge key={sub} variant="warning">
                          {sub}
                        </Badge>
                      ))
                  )}
                </div>
              </div>

              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3">
                <span className="text-xs text-[var(--fg-muted)]">
                  Missing JSON-LD Schema Types
                </span>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {report.whatTop10HaveThatYouDont.missingSchemaTypes.length === 0 ? (
                    <Badge variant="good">Schema Parity</Badge>
                  ) : (
                    report.whatTop10HaveThatYouDont.missingSchemaTypes.map((sc) => (
                      <Badge key={sc} variant="critical">
                        {sc}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Actionable Gap Cards */}
            <div className="space-y-2.5">
              {report.whatTop10HaveThatYouDont.actionableGaps.map((gap, i) => (
                <div
                  key={i}
                  className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3.5 text-xs"
                >
                  <p className="font-semibold text-[var(--fg)]">{gap.title}</p>
                  <p className="mt-1 font-mono text-[var(--fg-muted)]">
                    Evidence: {gap.evidence}
                  </p>
                  <p className="mt-1 text-[var(--brand)]">
                    Fix: {gap.recommendation}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          {/* SERP Feature Opportunity Map */}
          <Card className="space-y-3">
            <h3 className="text-base font-semibold text-[var(--fg)]">
              SERP Feature Map &amp; Eligibility Strategy
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {report.serpFeatures.map((feat) => (
                <div
                  key={feat.feature}
                  className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[var(--fg)]">
                      {feat.feature}
                    </span>
                    <Badge variant={feat.present ? "good" : "neutral"}>
                      {feat.present ? "Active on SERP" : "Optional"}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-[var(--fg-muted)]">
                    {feat.opportunity}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          {/* Side-by-Side Page Structure Comparison */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-[var(--fg)]">
                  Your Best Matching Page
                </h3>
                <Badge variant={report.yourPage.found ? "brand" : "warning"}>
                  {report.yourPage.found ? "Crawled Page Match" : "No Crawled Match"}
                </Badge>
              </div>
              {report.yourPage.found ? (
                <div className="space-y-2 text-xs">
                  <p className="font-mono text-[var(--brand)]">{report.yourPage.url}</p>
                  <p className="font-semibold text-[var(--fg)]">
                    {report.yourPage.title ?? "— Missing <title> —"}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="neutral">{report.yourPage.wordCount} words</Badge>
                    <Badge variant="neutral">{report.yourPage.h2s.length} H2s</Badge>
                    {report.yourPage.schemaTypes.map((s) => (
                      <Badge key={s} variant="good">
                        {s}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-2 space-y-1 border-t border-[var(--border)] pt-2">
                    <span className="font-semibold text-[var(--fg-muted)]">
                      H2 Outline:
                    </span>
                    {report.yourPage.h2s.length === 0 ? (
                      <p className="text-[var(--fg-subtle)]">No H2 headings found.</p>
                    ) : (
                      report.yourPage.h2s.slice(0, 6).map((h, idx) => (
                        <p key={idx} className="text-[var(--fg)]">
                          • {h}
                        </p>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[var(--fg-muted)]">
                  Run a Site Audit first or create a dedicated article in Content Studio for &ldquo;{report.query}&rdquo;.
                </p>
              )}
            </Card>

            <Card className="space-y-3">
              <h3 className="text-base font-semibold text-[var(--fg)]">
                Top Competitor Page Structures ({report.competitorPages.length})
              </h3>
              <div className="space-y-3">
                {report.competitorPages.map((comp) => (
                  <div
                    key={comp.url}
                    className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-[var(--brand)]">
                        #{comp.position} {comp.host}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="neutral">{comp.wordCount} words</Badge>
                        {comp.schemaTypes.map((s) => (
                          <Badge key={s} variant="info">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <p className="mt-1 font-semibold text-[var(--fg)]">
                      {comp.title}
                    </p>
                    <div className="mt-2 space-y-0.5 text-[11px] text-[var(--fg-muted)]">
                      {comp.h2s.slice(0, 4).map((h, i) => (
                        <p key={i}>H2: {h}</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
