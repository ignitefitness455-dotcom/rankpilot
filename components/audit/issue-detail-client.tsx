"use client";

import * as React from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  EyeOff,
  RotateCcw,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Link, useRouter } from "@/lib/i18n/routing";
import { Badge, Button, Card, Input, SeverityBadge } from "@/components/ui/primitives";
import type { Evidence, Finding } from "@/lib/schemas/finding";

export interface IssueDetailClientProps {
  projectId: string;
  issue: {
    id: string;
    ruleId: string;
    category: Finding["category"];
    severity: Finding["severity"];
    status: "open" | "fixed" | "ignored" | "regressed";
    affectedCount: number;
    finding: Finding;
    ignoredReason: string | null;
    updatedAt: string;
  };
  instances: Array<{
    id: string;
    crawlId: string;
    pageId: string | null;
    evidence: Evidence[];
  }>;
}

export function IssueDetailClient({
  projectId,
  issue: initialIssue,
  instances,
}: IssueDetailClientProps) {
  const router = useRouter();
  const [issue, setIssue] = React.useState(initialIssue);
  const [ignoreReason, setIgnoreReason] = React.useState(
    initialIssue.ignoredReason ?? "",
  );
  const [updating, setUpdating] = React.useState(false);

  const handleUpdateStatus = async (
    nextStatus: "open" | "fixed" | "ignored",
  ) => {
    setUpdating(true);
    try {
      const res = await fetch(`/api/v1/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: nextStatus,
          ignoredReason:
            nextStatus === "ignored"
              ? ignoreReason.trim() || "Ignored by site owner"
              : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error?.message || "Failed to update status");
      }
      setIssue((prev) => ({
        ...prev,
        status: nextStatus,
        ignoredReason: json.data.issue.ignoredReason ?? null,
      }));
      toast.success(`Issue status updated to ${nextStatus}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update status");
    } finally {
      setUpdating(false);
    }
  };

  const { finding } = issue;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/p/${projectId}/audit`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--fg-muted)] hover:text-[var(--fg)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Site Audit
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          {issue.status !== "open" && (
            <Button
              size="sm"
              variant="secondary"
              disabled={updating}
              onClick={() => handleUpdateStatus("open")}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Re-open Issue
            </Button>
          )}
          {issue.status !== "fixed" && (
            <Button
              size="sm"
              variant="secondary"
              disabled={updating}
              onClick={() => handleUpdateStatus("fixed")}
              data-testid="mark-issue-fixed-btn"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Mark Fixed
            </Button>
          )}
        </div>
      </div>

      {/* Issue Header Card */}
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge
            severity={issue.severity}
            label={issue.severity.toUpperCase()}
          />
          <Badge
            variant={
              issue.status === "fixed"
                ? "good"
                : issue.status === "regressed"
                  ? "critical"
                  : "neutral"
            }
          >
            {issue.status.toUpperCase()}
          </Badge>
          <Badge variant="brand">{issue.category}</Badge>
          <span className="font-mono text-xs font-semibold text-[var(--fg-subtle)]">
            {issue.ruleId}
          </span>
          {finding.is_estimate && (
            <Badge variant="warning">
              ESTIMATE ({Math.round(finding.confidence * 100)}% confidence)
            </Badge>
          )}
        </div>

        <h1 className="text-xl font-bold text-[var(--fg)]">{finding.title}</h1>

        <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
            Why It Matters
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--fg)]">
            {finding.why_it_matters}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-[8px] border border-[var(--border)] p-3">
            <p className="text-xs text-[var(--fg-muted)]">Affected URLs</p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums text-[var(--fg)]">
              {issue.affectedCount}
            </p>
          </div>
          <div className="rounded-[8px] border border-[var(--border)] p-3">
            <p className="text-xs text-[var(--fg-muted)]">SEO Impact</p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums text-[var(--fg)]">
              {finding.impact} / 5
            </p>
          </div>
          <div className="rounded-[8px] border border-[var(--border)] p-3">
            <p className="text-xs text-[var(--fg-muted)]">Implementation Effort</p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums text-[var(--fg)]">
              {finding.effort} / 5
            </p>
          </div>
          <div className="rounded-[8px] border border-[var(--border)] p-3">
            <p className="text-xs text-[var(--fg-muted)]">Confidence</p>
            <p className="mt-1 font-mono text-lg font-bold tabular-nums text-[var(--fg)]">
              {Math.round(finding.confidence * 100)}%
            </p>
          </div>
        </div>
      </Card>

      {/* Exact Fix Card */}
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-[var(--brand)]" />
            <h2 className="text-base font-semibold text-[var(--fg)]">
              Exact Step-by-Step Fix
            </h2>
          </div>
          <Badge variant="neutral">{finding.fix.language}</Badge>
        </div>

        <ol className="list-decimal space-y-2 ps-5 text-sm text-[var(--fg)]">
          {finding.fix.steps.map((step, idx) => (
            <li key={idx} className="leading-relaxed">
              {step}
            </li>
          ))}
        </ol>

        {finding.fix.code_snippet && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--fg-muted)]">
                Copy-Paste Code Snippet ({finding.fix.language})
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(finding.fix.code_snippet ?? "");
                  toast.success("Copied fix code snippet");
                }}
                data-testid="copy-fix-snippet-btn"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy Fix
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4 font-mono text-xs leading-relaxed text-[var(--fg)]">
              {finding.fix.code_snippet}
            </pre>
          </div>
        )}
      </Card>

      {/* Verifiable Evidence & Affected Pages */}
      <Card className="space-y-4">
        <h2 className="text-base font-semibold text-[var(--fg)]">
          Verifiable Evidence ({instances.length || finding.evidence.length})
        </h2>

        <div className="divide-y divide-[var(--border)]">
          {(instances.length > 0
            ? instances.flatMap((inst) =>
                inst.evidence.map((ev) => ({
                  ...ev,
                  pageId: inst.pageId,
                })),
              )
            : finding.evidence.map((ev) => ({ ...ev, pageId: null }))
          ).map((ev, idx) => (
            <div
              key={`${ev.url}-${idx}`}
              className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-center"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={ev.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-[var(--brand)] hover:underline"
                  >
                    {ev.url}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <Badge variant="neutral">{ev.source}</Badge>
                  <span className="font-mono text-[11px] text-[var(--fg-subtle)]">
                    {new Date(ev.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="font-mono text-xs text-[var(--fg-muted)]">
                  {ev.observed}
                </p>
              </div>

              {ev.pageId && (
                <Link href={`/p/${projectId}/pages/${ev.pageId}`}>
                  <Button size="sm" variant="secondary">
                    Inspect Page
                  </Button>
                </Link>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Ignore Rule Panel */}
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-[var(--fg)]">
          Ignore This Rule for Project
        </h2>
        <p className="text-xs text-[var(--fg-muted)]">
          Ignored rules are stored in Project Memory so the crawler and AI agent will not re-alert or suggest tasks for this rule.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Optional reason (e.g. Intentional canonical setup on staging)"
            value={ignoreReason}
            onChange={(e) => setIgnoreReason(e.target.value)}
            className="sm:w-96"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={updating}
            onClick={() => handleUpdateStatus("ignored")}
            data-testid="ignore-issue-btn"
          >
            <EyeOff className="h-3.5 w-3.5" />
            Ignore Rule
          </Button>
        </div>
      </Card>
    </div>
  );
}
