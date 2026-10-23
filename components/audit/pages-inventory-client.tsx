"use client";

import * as React from "react";
import { AlertTriangle, ExternalLink, Search } from "lucide-react";
import { Link } from "@/lib/i18n/routing";
import { Badge, Button, Card, Input, Select } from "@/components/ui/primitives";

export interface PageInventoryRow {
  id: string;
  url: string;
  finalUrl: string | null;
  statusCode: number | null;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robotsMeta: string | null;
  wordCount: number | null;
  depth: number | null;
  inlinks: number;
  outlinks: number;
  ttfbMs: number | null;
  bytes: number | null;
  schemaTypes: string[] | null;
  injectionFlag: boolean;
}

export interface PagesInventoryClientProps {
  projectId: string;
  crawlId: string | null;
  initialPages: PageInventoryRow[];
}

export function PagesInventoryClient({
  projectId,
  crawlId,
  initialPages,
}: PagesInventoryClientProps) {
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [query, setQuery] = React.useState<string>("");

  const filtered = initialPages.filter((p) => {
    const code = p.statusCode ?? 0;
    if (statusFilter === "2xx" && (code < 200 || code >= 300)) return false;
    if (statusFilter === "3xx" && (code < 300 || code >= 400)) return false;
    if (statusFilter === "4xx" && (code < 400 || code >= 500)) return false;
    if (statusFilter === "5xx" && code < 500) return false;
    if (statusFilter === "orphan" && (p.inlinks > 0 || p.depth === 0)) return false;

    const q = query.trim().toLowerCase();
    if (
      q &&
      !p.url.toLowerCase().includes(q) &&
      !(p.title ?? "").toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });

  const orphanCount = initialPages.filter(
    (p) => p.inlinks === 0 && p.depth !== 0 && (p.statusCode ?? 0) < 400,
  ).length;
  const maxDepth = initialPages.reduce(
    (acc, p) => (p.depth !== null && p.depth > acc ? p.depth : acc),
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--fg)]">
            Crawled Pages &amp; Internal Link Graph
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            Inspect every crawled URL, click depth, incoming/outgoing internal links, word count, TTFB, and structured data.
          </p>
        </div>

        <Link href={`/p/${projectId}/audit`}>
          <Button variant="secondary" size="sm">
            Back to Site Audit
          </Button>
        </Link>
      </div>

      {/* Link Graph Summary KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs font-medium text-[var(--fg-muted)]">Total Crawled Pages</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--fg)]">
            {initialPages.length}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-[var(--fg-muted)]">200 OK Pages</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--good)]">
            {
              initialPages.filter(
                (p) => (p.statusCode ?? 0) >= 200 && (p.statusCode ?? 0) < 300,
              ).length
            }
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-[var(--fg-muted)]">Orphan Pages (0 Inlinks)</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--warning)]">
            {orphanCount}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-[var(--fg-muted)]">Max Click Depth</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-[var(--fg)]">
            {maxDepth}
          </p>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-2.5 h-4 w-4 text-[var(--fg-subtle)]" />
          <Input
            placeholder="Search by URL or page title..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ps-9"
          />
        </div>

        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="sm:w-48"
          aria-label="Filter pages by status"
        >
          <option value="all">All Pages ({initialPages.length})</option>
          <option value="2xx">2xx OK</option>
          <option value="3xx">3xx Redirected</option>
          <option value="4xx">4xx Client Errors</option>
          <option value="5xx">5xx Server Errors</option>
          <option value="orphan">Orphan Pages (0 Inlinks)</option>
        </Select>
      </Card>

      {/* Pages Table */}
      <Card className="overflow-hidden p-0">
        {!crawlId || filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--fg-muted)]">
            {!crawlId
              ? "No crawl completed yet. Run a Site Audit first to populate the page inventory."
              : "No crawled pages match the current filter."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs">
              <thead className="border-b border-[var(--border)] bg-[var(--surface-2)] text-[11px] uppercase tracking-wider text-[var(--fg-muted)]">
                <tr>
                  <th className="px-4 py-3 text-start">URL &amp; Title</th>
                  <th className="px-3 py-3 text-start">Status</th>
                  <th className="px-3 py-3 text-end">Depth</th>
                  <th className="px-3 py-3 text-end">Inlinks</th>
                  <th className="px-3 py-3 text-end">Outlinks</th>
                  <th className="px-3 py-3 text-end">Words</th>
                  <th className="px-3 py-3 text-end">TTFB</th>
                  <th className="px-4 py-3 text-end">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map((p) => {
                  const status = p.statusCode ?? 0;
                  const statusVariant =
                    status >= 200 && status < 300
                      ? "good"
                      : status >= 300 && status < 400
                        ? "warning"
                        : "critical";
                  return (
                    <tr
                      key={p.id}
                      className="transition-colors hover:bg-[var(--surface-2)]/50"
                    >
                      <td className="max-w-md px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/p/${projectId}/pages/${p.id}`}
                            className="truncate font-mono font-semibold text-[var(--brand)] hover:underline"
                          >
                            {p.url}
                          </Link>
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[var(--fg-subtle)] hover:text-[var(--fg)]"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          {p.injectionFlag && (
                            <span title="Prompt injection flagged">
                              <AlertTriangle className="h-3.5 w-3.5 text-[var(--critical)]" />
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[var(--fg-muted)]">
                          {p.title || "(No <title> tag)"}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={statusVariant}>{status || "ERR"}</Badge>
                      </td>
                      <td className="px-3 py-3 text-end font-mono tabular-nums text-[var(--fg)]">
                        {p.depth !== null ? p.depth : "Orphan"}
                      </td>
                      <td className="px-3 py-3 text-end font-mono tabular-nums text-[var(--fg)]">
                        {p.inlinks}
                      </td>
                      <td className="px-3 py-3 text-end font-mono tabular-nums text-[var(--fg)]">
                        {p.outlinks}
                      </td>
                      <td className="px-3 py-3 text-end font-mono tabular-nums text-[var(--fg)]">
                        {p.wordCount ?? 0}
                      </td>
                      <td className="px-3 py-3 text-end font-mono tabular-nums text-[var(--fg-muted)]">
                        {p.ttfbMs !== null ? `${p.ttfbMs}ms` : "—"}
                      </td>
                      <td className="px-4 py-3 text-end">
                        <Link href={`/p/${projectId}/pages/${p.id}`}>
                          <Button size="sm" variant="secondary">
                            Details
                          </Button>
                        </Link>
                      </td>
                    </tr>
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
