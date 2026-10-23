"use client";

import * as React from "react";
import { ArrowLeft, Copy, ExternalLink, Link2, Sparkles } from "lucide-react";
import { Link } from "@/lib/i18n/routing";
import { Badge, Button, Card, SeverityBadge } from "@/components/ui/primitives";
import type { OnPageOptimizationReport } from "@/lib/onpage/optimizer";
import type { Evidence, Finding } from "@/lib/schemas/finding";

export interface PageDetailClientProps {
  projectId: string;
  page: {
    id: string;
    url: string;
    finalUrl: string | null;
    statusCode: number | null;
    redirectChain: Array<{ url: string; status: number }> | null;
    contentType: string | null;
    title: string | null;
    metaDescription: string | null;
    canonical: string | null;
    robotsMeta: string | null;
    xRobots: string | null;
    hreflang: Array<{ lang: string; href: string }> | null;
    h1: string[] | null;
    headings: Array<{ level: number; text: string }> | null;
    wordCount: number | null;
    textHash: string | null;
    depth: number | null;
    inlinks: number;
    outlinks: number;
    schemaTypes: string[] | null;
    schemaRaw: unknown[] | null;
    hasViewport: boolean | null;
    lang: string | null;
    bytes: number | null;
    ttfbMs: number | null;
    rendered: boolean;
    injectionFlag: boolean;
    summary: string | null;
  };
  outgoingLinks: Array<{
    id: string;
    toUrl: string;
    toPageId: string | null;
    anchor: string | null;
    rel: string | null;
    isInternal: boolean;
    statusCode: number | null;
  }>;
  incomingLinks: Array<{
    id: string;
    fromPageId: string;
    fromUrl: string;
    fromTitle: string | null;
    anchor: string | null;
    rel: string | null;
  }>;
  issues: Array<{
    instanceId: string;
    evidence: Evidence[];
    issueId: string;
    ruleId: string;
    category: Finding["category"];
    severity: Finding["severity"];
    status: string;
    finding: Finding;
  }>;
}

export function PageDetailClient({
  projectId,
  page,
  outgoingLinks,
  incomingLinks,
  issues,
}: PageDetailClientProps) {
  const [targetKeywordInput, setTargetKeywordInput] = React.useState("");
  const [optimizing, setOptimizing] = React.useState(false);
  const [optReport, setOptReport] = React.useState<OnPageOptimizationReport | null>(
    null,
  );
  const [optError, setOptError] = React.useState<string | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  async function handleRunOptimizer(e: React.FormEvent) {
    e.preventDefault();
    setOptimizing(true);
    setOptError(null);
    try {
      const res = await fetch(`/api/v1/pages/${page.id}/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetKeyword: targetKeywordInput.trim() || undefined,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { report: OnPageOptimizationReport };
        error?: { message?: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "Failed to optimize page");
      }
      setOptReport(json.data.report);
    } catch (err) {
      setOptError(err instanceof Error ? err.message : "On-page analysis failed");
    } finally {
      setOptimizing(false);
    }
  }

  function handleCopyText(id: string, text: string) {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/p/${projectId}/pages`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--fg-muted)] hover:text-[var(--fg)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Crawled Pages
        </Link>

        <a
          href={page.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--brand)] hover:underline"
        >
          Open Live URL
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {/* URL & Primary Signals */}
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={
              (page.statusCode ?? 0) >= 200 && (page.statusCode ?? 0) < 300
                ? "good"
                : "critical"
            }
          >
            HTTP {page.statusCode ?? "ERR"}
          </Badge>
          <Badge variant="neutral">
            Depth: {page.depth !== null ? page.depth : "Orphan"}
          </Badge>
          <Badge variant="neutral">{page.wordCount ?? 0} words</Badge>
          <Badge variant="neutral">TTFB: {page.ttfbMs ?? 0}ms</Badge>
          <Badge variant="neutral">
            Size: {Math.round((page.bytes ?? 0) / 1024)} KB
          </Badge>
          {page.rendered && <Badge variant="brand">Playwright Rendered</Badge>}
          {page.injectionFlag && (
            <Badge variant="critical">Prompt Injection Flagged</Badge>
          )}
        </div>

        <div>
          <h1 className="break-all font-mono text-lg font-bold text-[var(--fg)]">
            {page.url}
          </h1>
          {page.summary && (
            <p className="mt-2 text-xs leading-relaxed text-[var(--fg-muted)]">
              {page.summary}
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="flex items-center justify-between text-xs text-[var(--fg-muted)]">
              <span className="font-semibold">Title Tag</span>
              <span className="font-mono">{page.title?.length ?? 0} chars</span>
            </div>
            <p className="mt-1 text-sm font-medium text-[var(--fg)]">
              {page.title || "— Missing <title> —"}
            </p>
          </div>

          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="flex items-center justify-between text-xs text-[var(--fg-muted)]">
              <span className="font-semibold">Meta Description</span>
              <span className="font-mono">
                {page.metaDescription?.length ?? 0} chars
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--fg)]">
              {page.metaDescription || "— Missing <meta name=\"description\"> —"}
            </p>
          </div>

          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3">
            <span className="text-xs font-semibold text-[var(--fg-muted)]">
              Canonical URL
            </span>
            <p className="mt-1 break-all font-mono text-xs text-[var(--fg)]">
              {page.canonical || "— Missing <link rel=\"canonical\"> —"}
            </p>
          </div>

          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3">
            <span className="text-xs font-semibold text-[var(--fg-muted)]">
              Indexing &amp; Technical Meta
            </span>
            <p className="mt-1 font-mono text-xs text-[var(--fg)]">
              robots={page.robotsMeta || "index,follow"} · viewport=
              {page.hasViewport ? "yes" : "no"} · lang={page.lang || "unset"} · simhash=
              {page.textHash || "—"}
            </p>
          </div>
        </div>
      </Card>

      {/* Interactive On-Page Optimizer Panel (Phase 4) */}
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-[var(--fg)]">
              On-Page Optimizer (Title/Meta Variants, Entities, Internal Links &amp; JSON-LD)
            </h2>
            <p className="text-xs text-[var(--fg-muted)]">
              Evaluate this URL against a target keyword (or leave blank to auto-infer from Search Console / H1) and generate 3 copy-paste title &amp; meta description variants.
            </p>
          </div>
          {optReport && (
            <div className="flex items-center gap-2">
              <Badge variant="brand">
                On-Page Score: {optReport.onPageScore}/100
              </Badge>
              <Badge variant="info">
                {optReport.intent} ({Math.round(optReport.intentConfidence * 100)}%)
              </Badge>
            </div>
          )}
        </div>

        <form
          onSubmit={handleRunOptimizer}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1 space-y-1">
            <label
              htmlFor="onpage-kw-input"
              className="block text-xs font-semibold text-[var(--fg)]"
            >
              Target Keyword (optional — auto-detected from GSC or H1 if blank)
            </label>
            <input
              id="onpage-kw-input"
              type="text"
              value={targetKeywordInput}
              onChange={(e) => setTargetKeywordInput(e.target.value)}
              placeholder="e.g. technical seo audit tool"
              className="h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--fg)] focus:border-[var(--brand)] focus:outline-none"
            />
          </div>
          <Button type="submit" size="sm" disabled={optimizing}>
            <Sparkles className="h-3.5 w-3.5" />
            {optimizing ? "Optimizing Page..." : "Run On-Page Optimizer"}
          </Button>
        </form>
        {optError && <p className="text-xs text-[var(--crit)]">{optError}</p>}

        {optReport && (
          <div className="space-y-5 border-t border-[var(--border)] pt-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[var(--fg-muted)]">Target Keyword:</span>
              <strong className="font-mono text-[var(--fg)]">
                {optReport.targetKeyword}
              </strong>
              <Badge variant="neutral">Source: {optReport.inferredFrom}</Badge>
              <Badge variant="good">
                Intent Match: {optReport.intentMatchScore}/100
              </Badge>
            </div>

            {/* 3 Title & Meta Description Variants */}
            <div className="space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
                3 Title Tag &amp; Meta Description Variants (Live Character &amp; Pixel Estimates)
              </h3>
              <div className="grid gap-3 lg:grid-cols-3">
                {optReport.variants.map((v) => (
                  <div
                    key={v.id}
                    className="flex flex-col justify-between space-y-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3 text-xs"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[var(--brand)]">
                          {v.label}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--fg-muted)]">
                        {v.rationale}
                      </p>

                      <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                        <div className="flex items-center justify-between text-[10px] text-[var(--fg-subtle)]">
                          <span>&lt;title&gt;</span>
                          <span className="font-mono">
                            {v.titleChars} chars (~{v.titlePixelEst}px) ·{" "}
                            {v.titleStatus}
                          </span>
                        </div>
                        <p className="mt-1 font-medium text-[var(--fg)]">
                          {v.title}
                        </p>
                      </div>

                      <div className="rounded border border-[var(--border)] bg-[var(--surface-2)] p-2">
                        <div className="flex items-center justify-between text-[10px] text-[var(--fg-subtle)]">
                          <span>meta description</span>
                          <span className="font-mono">
                            {v.metaChars} chars (~{v.metaPixelEst}px) ·{" "}
                            {v.metaStatus}
                          </span>
                        </div>
                        <p className="mt-1 text-[var(--fg)]">
                          {v.metaDescription}
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          handleCopyText(
                            `${v.id}-html`,
                            `<title>${v.title}</title>\n<meta name="description" content="${v.metaDescription}" />`,
                          )
                        }
                      >
                        <Copy className="h-3 w-3" />
                        {copiedId === `${v.id}-html`
                          ? "Copied HTML!"
                          : "Copy HTML Tags"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Entities & Internal Link Opportunities */}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
                <h4 className="font-semibold text-[var(--fg)]">
                  Entity &amp; Subtopic Coverage
                </h4>
                <div>
                  <span className="text-[11px] text-[var(--fg-muted)]">
                    Present on Page:
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {optReport.entitiesPresent.length === 0 ? (
                      <span className="text-[var(--fg-subtle)]">None detected</span>
                    ) : (
                      optReport.entitiesPresent.map((e) => (
                        <Badge key={e} variant="good">
                          {e}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
                <div className="pt-1">
                  <span className="text-[11px] text-[var(--fg-muted)]">
                    Recommended to Add:
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {optReport.entitiesMissing.map((e) => (
                      <Badge key={e} variant="warning">
                        + {e}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
                <h4 className="font-semibold text-[var(--fg)]">
                  Internal Link Opportunities ({optReport.internalLinkOpportunities.length})
                </h4>
                {optReport.internalLinkOpportunities.length === 0 ? (
                  <p className="text-[var(--fg-muted)]">
                    All other crawled pages already link to this URL (or only 1 page crawled).
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {optReport.internalLinkOpportunities.map((opp) => (
                      <div
                        key={opp.sourcePageId}
                        className="border-b border-[var(--border)] pb-1.5 last:border-0"
                      >
                        <Link
                          href={`/p/${projectId}/pages/${opp.sourcePageId}`}
                          className="font-mono font-semibold text-[var(--brand)] hover:underline"
                        >
                          {opp.sourceUrl}
                        </Link>
                        <p className="text-[11px] text-[var(--fg-muted)]">
                          Suggested anchor:{" "}
                          <strong className="text-[var(--fg)]">
                            {opp.suggestedAnchorText}
                          </strong>{" "}
                          ({opp.sourceInlinks} inlinks)
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Active Audit Findings on This Page */}
      <Card className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--fg)]">
          Audit Issues on This Page ({issues.length})
        </h2>
        {issues.length === 0 ? (
          <p className="text-xs text-[var(--fg-muted)]">
            No audit issues triggered on this URL.
          </p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {issues.map((item) => (
              <div
                key={item.instanceId}
                className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-center"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <SeverityBadge
                      severity={item.severity}
                      label={item.severity.toUpperCase()}
                    />
                    <span className="font-mono text-xs text-[var(--fg-subtle)]">
                      {item.ruleId}
                    </span>
                    <Link
                      href={`/p/${projectId}/audit/${item.issueId}`}
                      className="text-sm font-semibold text-[var(--fg)] hover:text-[var(--brand)]"
                    >
                      {item.finding.title}
                    </Link>
                  </div>
                  {item.evidence[0] && (
                    <p className="font-mono text-xs text-[var(--fg-muted)]">
                      {item.evidence[0].observed}
                    </p>
                  )}
                </div>

                <Link href={`/p/${projectId}/audit/${item.issueId}`}>
                  <Button size="sm" variant="secondary">
                    View Fix
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Heading Outline & Structured Data */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="text-base font-semibold text-[var(--fg)]">
            Heading Hierarchy ({page.headings?.length ?? 0})
          </h2>
          {!page.headings || page.headings.length === 0 ? (
            <p className="text-xs text-[var(--fg-muted)]">No headings extracted.</p>
          ) : (
            <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {page.headings.map((h, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs"
                  style={{ paddingInlineStart: `${(h.level - 1) * 12}px` }}
                >
                  <Badge variant={h.level === 1 ? "brand" : "neutral"}>
                    H{h.level}
                  </Badge>
                  <span className="text-[var(--fg)]">{h.text}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--fg)]">
              JSON-LD Structured Data
            </h2>
            <div className="flex flex-wrap gap-1">
              {(page.schemaTypes ?? []).map((t) => (
                <Badge key={t} variant="brand">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
          {!page.schemaRaw || page.schemaRaw.length === 0 ? (
            <p className="text-xs text-[var(--fg-muted)]">
              No JSON-LD structured data blocks found on this page.
            </p>
          ) : (
            <pre className="max-h-72 overflow-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs text-[var(--fg)]">
              {JSON.stringify(page.schemaRaw, null, 2)}
            </pre>
          )}
        </Card>
      </div>

      {/* Incoming & Outgoing Links */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="space-y-3">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-[var(--brand)]" />
            <h2 className="text-base font-semibold text-[var(--fg)]">
              Incoming Internal Links ({incomingLinks.length})
            </h2>
          </div>
          {incomingLinks.length === 0 ? (
            <p className="text-xs text-[var(--fg-muted)]">
              Zero incoming internal links from other crawled pages.
            </p>
          ) : (
            <div className="max-h-72 divide-y divide-[var(--border)] overflow-y-auto">
              {incomingLinks.map((inc) => (
                <div key={inc.id} className="py-2 text-xs">
                  <Link
                    href={`/p/${projectId}/pages/${inc.fromPageId}`}
                    className="font-mono font-semibold text-[var(--brand)] hover:underline"
                  >
                    {inc.fromUrl}
                  </Link>
                  <p className="text-[var(--fg-muted)]">
                    Anchor: <strong className="text-[var(--fg)]">{inc.anchor || "(empty)"}</strong>
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-[var(--fg-subtle)]" />
            <h2 className="text-base font-semibold text-[var(--fg)]">
              Outgoing Links ({outgoingLinks.length})
            </h2>
          </div>
          {outgoingLinks.length === 0 ? (
            <p className="text-xs text-[var(--fg-muted)]">No outgoing links found.</p>
          ) : (
            <div className="max-h-72 divide-y divide-[var(--border)] overflow-y-auto">
              {outgoingLinks.map((out) => (
                <div
                  key={out.id}
                  className="flex items-center justify-between gap-2 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[var(--fg)]">{out.toUrl}</p>
                    <p className="truncate text-[var(--fg-muted)]">
                      Anchor: {out.anchor || "(empty)"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant={out.isInternal ? "neutral" : "info"}>
                      {out.isInternal ? "Internal" : "External"}
                    </Badge>
                    {out.statusCode && (
                      <Badge
                        variant={out.statusCode < 400 ? "good" : "critical"}
                      >
                        {out.statusCode}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
