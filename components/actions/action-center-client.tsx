"use client";

import * as React from "react";
import {
  CheckCircle2,
  Copy,
  Download,
  Plus,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import type {
  ActionCenterOverview,
  TaskItemDto,
} from "@/lib/actions/service";
import type { TaskStatus } from "@/lib/db/schema";

export interface ActionCenterClientProps {
  projectId: string;
  initialOverview: ActionCenterOverview;
}

const KANBAN_COLUMNS: Array<{ status: TaskStatus; label: string }> = [
  { status: "todo", label: "To Do (Pending Review)" },
  { status: "in_progress", label: "In Progress (Approved)" },
  { status: "done", label: "Done (Verified)" },
];

export function ActionCenterClient({
  projectId,
  initialOverview,
}: ActionCenterClientProps) {
  const [overview, setOverview] =
    React.useState<ActionCenterOverview>(initialOverview);
  const [syncing, setSyncing] = React.useState(false);
  const [showNewForm, setShowNewForm] = React.useState(false);

  const [newTitle, setNewTitle] = React.useState("");
  const [newDesc, setNewDesc] = React.useState("");
  const [newImpact, setNewImpact] = React.useState(4);
  const [newEffort, setNewEffort] = React.useState(2);
  const [newSnippet, setNewSnippet] = React.useState("");
  const [creating, setCreating] = React.useState(false);

  const [exportOutput, setExportOutput] = React.useState<{
    filename: string;
    content: string;
  } | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  async function handleSyncFromAudit() {
    setSyncing(true);
    setToast(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_from_audit" }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { syncedCount: number; overview: ActionCenterOverview };
        error?: { message?: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "Failed to sync audit issues");
      }
      setOverview(json.data.overview);
      setToast(
        `Synced ${json.data.syncedCount} new task(s) from open Site Audit issues.`,
      );
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    setToast(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          title: newTitle.trim(),
          description: newDesc.trim() || undefined,
          impact: newImpact,
          effort: newEffort,
          confidence: 0.9,
          fixSnippet: newSnippet.trim() || undefined,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { task: TaskItemDto };
        error?: { message?: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "Failed to create task");
      }
      setOverview((prev) => ({
        ...prev,
        tasks: [json.data!.task, ...prev.tasks],
      }));
      setNewTitle("");
      setNewDesc("");
      setNewSnippet("");
      setShowNewForm(false);
      setToast("Created prioritized task in Action Center.");
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Task creation failed");
    } finally {
      setCreating(false);
    }
  }

  async function handleTaskDecision(
    task: TaskItemDto,
    payload: {
      status?: TaskStatus;
      decision?: "approve" | "edit" | "dismiss";
    },
  ) {
    try {
      const res = await fetch(`/api/v1/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { task: TaskItemDto };
      };
      if (res.ok && json.ok && json.data) {
        const updated = json.data.task;
        setOverview((prev) => ({
          ...prev,
          tasks: prev.tasks.map((t) => (t.id === updated.id ? updated : t)),
        }));
        if (payload.decision) {
          setToast(
            `Recorded '${payload.decision}' decision in append-only Approval Log.`,
          );
        }
      }
    } catch {
      // Ignore transient error
    }
  }

  async function handleExport(format: "markdown" | "json" | "csv" | "git_patch") {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/tasks/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, onlyApproved: false }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { filename: string; content: string; count: number };
      };
      if (res.ok && json.ok && json.data) {
        setExportOutput({
          filename: json.data.filename,
          content: json.data.content,
        });
        setToast(
          `Exported ${json.data.count} task(s) as ${json.data.filename} & logged to Approval Audit Trail.`,
        );
      }
    } catch {
      // Ignore transient error
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--fg)]">
            Action Center &amp; Human Approval Gate
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            Review prioritized SEO fixes (`Impact × Confidence × (6 - Effort)`), approve or dismiss recommendations, and export copy-paste fixes or Git patches.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleSyncFromAudit}
            disabled={syncing}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {syncing ? "Syncing Audit Issues..." : "Sync From Site Audit"}
          </Button>
          <Button size="sm" onClick={() => setShowNewForm((v) => !v)}>
            <Plus className="h-3.5 w-3.5" />
            New Task
          </Button>
        </div>
      </div>

      {toast && (
        <div className="rounded-[8px] border border-[var(--brand)]/40 bg-[var(--brand-subtle)]/30 px-3 py-2 text-xs font-medium text-[var(--brand)]">
          {toast}
        </div>
      )}

      {/* Multi-Format Export Toolbar */}
      <Card className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="flex items-center gap-2 text-xs">
          <ShieldCheck className="h-4 w-4 text-[var(--good)]" />
          <span className="font-semibold text-[var(--fg)]">
            Export Action Plan &amp; Copy-Paste Fixes:
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => handleExport("markdown")}
          >
            <Download className="h-3.5 w-3.5" />
            Markdown (.md)
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => handleExport("git_patch")}
          >
            <Download className="h-3.5 w-3.5" />
            Git Patch (.patch)
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => handleExport("csv")}
          >
            <Download className="h-3.5 w-3.5" />
            CSV (.csv)
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => handleExport("json")}
          >
            <Download className="h-3.5 w-3.5" />
            JSON (.json)
          </Button>
        </div>
      </Card>

      {exportOutput && (
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-bold text-[var(--fg)]">
              Export Preview: {exportOutput.filename}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(exportOutput.content);
                  setToast(`Copied ${exportOutput.filename} to clipboard.`);
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setExportOutput(null)}
              >
                Close
              </Button>
            </div>
          </div>
          <pre className="max-h-64 overflow-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs text-[var(--fg)]">
            {exportOutput.content}
          </pre>
        </Card>
      )}

      {/* New Task Form */}
      {showNewForm && (
        <Card className="space-y-3">
          <h2 className="text-sm font-bold text-[var(--fg)]">
            Create Prioritized SEO Task
          </h2>
          <form onSubmit={handleCreateTask} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Task title (e.g. Add FAQPage JSON-LD to /pricing)"
                className="h-9 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--fg)] sm:col-span-2"
              />
              <div className="flex items-center gap-2 text-xs">
                <label className="flex items-center gap-1">
                  Impact:
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={newImpact}
                    onChange={(e) => setNewImpact(Number(e.target.value))}
                    className="h-9 w-14 rounded border border-[var(--border)] bg-[var(--surface)] px-2 font-mono"
                  />
                </label>
                <label className="flex items-center gap-1">
                  Effort:
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={newEffort}
                    onChange={(e) => setNewEffort(Number(e.target.value))}
                    className="h-9 w-14 rounded border border-[var(--border)] bg-[var(--surface)] px-2 font-mono"
                  />
                </label>
              </div>
            </div>
            <textarea
              rows={2}
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Why it matters and step-by-step instructions..."
              className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-2.5 text-xs text-[var(--fg)]"
            />
            <textarea
              rows={3}
              value={newSnippet}
              onChange={(e) => setNewSnippet(e.target.value)}
              placeholder="Optional copy-paste code snippet (HTML, JSON-LD, nginx...)"
              className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-2.5 font-mono text-xs text-[var(--fg)]"
            />
            <Button type="submit" size="sm" disabled={creating}>
              {creating ? "Creating..." : "Save Task"}
            </Button>
          </form>
        </Card>
      )}

      {/* Kanban Board (Todo / In Progress / Done) */}
      <div className="grid gap-4 lg:grid-cols-3">
        {KANBAN_COLUMNS.map((col) => {
          const colTasks = overview.tasks.filter(
            (t) => t.status === col.status,
          );
          return (
            <div
              key={col.status}
              className="space-y-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface-2)] p-3.5"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-[var(--fg)]">
                  {col.label}
                </h2>
                <Badge variant="neutral">{colTasks.length}</Badge>
              </div>

              {colTasks.length === 0 ? (
                <p className="py-8 text-center text-xs text-[var(--fg-subtle)]">
                  No tasks in this column.
                </p>
              ) : (
                <div className="space-y-3">
                  {colTasks.map((task) => (
                    <div
                      key={task.id}
                      className="space-y-2.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="brand">P{task.priority}</Badge>
                        <div className="flex items-center gap-1">
                          <Badge variant="neutral">{task.source}</Badge>
                          {task.approvedAt && (
                            <Badge variant="good">Approved</Badge>
                          )}
                        </div>
                      </div>

                      <p className="font-semibold text-[var(--fg)]">
                        {task.title}
                      </p>

                      {task.description && (
                        <p className="line-clamp-3 text-[11px] text-[var(--fg-muted)]">
                          {task.description}
                        </p>
                      )}

                      <div className="flex flex-wrap gap-2 font-mono text-[10px] text-[var(--fg-subtle)]">
                        <span>Impact: {task.impact}/5</span>
                        <span>Effort: {task.effort}/5</span>
                        <span>Conf: {Math.round(task.confidence * 100)}%</span>
                      </div>

                      {task.fix?.snippet && (
                        <pre className="max-h-28 overflow-auto rounded border border-[var(--border)] bg-[var(--surface-2)] p-2 font-mono text-[10px] text-[var(--fg)]">
                          {task.fix.snippet}
                        </pre>
                      )}

                      <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-2">
                        {!task.approvedAt && (
                          <button
                            type="button"
                            onClick={() =>
                              handleTaskDecision(task, {
                                decision: "approve",
                                status: "in_progress",
                              })
                            }
                            className="inline-flex items-center gap-1 rounded bg-[var(--good-subtle)] px-2 py-1 text-[11px] font-semibold text-[var(--good)]"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            Approve
                          </button>
                        )}
                        {task.status !== "done" && (
                          <button
                            type="button"
                            onClick={() =>
                              handleTaskDecision(task, { status: "done" })
                            }
                            className="rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11px] font-medium text-[var(--fg)]"
                          >
                            Mark Done
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            handleTaskDecision(task, {
                              decision: "dismiss",
                              status: "ignored",
                            })
                          }
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[var(--fg-subtle)] hover:text-[var(--crit)]"
                        >
                          <XCircle className="h-3 w-3" />
                          Dismiss
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Append-Only Approval Audit Log & Ignored Rules */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-2.5">
          <h3 className="text-sm font-bold text-[var(--fg)]">
            Append-Only Human Approval Audit Log ({overview.approvals.length})
          </h3>
          {overview.approvals.length === 0 ? (
            <p className="text-xs text-[var(--fg-muted)]">
              No human approval or export events recorded yet.
            </p>
          ) : (
            <div className="max-h-48 divide-y divide-[var(--border)] overflow-y-auto text-xs">
              {overview.approvals.slice(0, 12).map((app) => (
                <div
                  key={app.id}
                  className="flex items-center justify-between py-2"
                >
                  <div>
                    <Badge
                      variant={
                        app.action === "approve"
                          ? "good"
                          : app.action === "dismiss"
                            ? "warning"
                            : "brand"
                      }
                    >
                      {app.action.toUpperCase()}
                    </Badge>
                    <span className="ml-2 font-mono text-[11px] text-[var(--fg-muted)]">
                      sha256:{app.payloadHash.slice(0, 12)}…
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-[var(--fg-subtle)]">
                    {new Date(app.at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="space-y-2.5">
          <h3 className="text-sm font-bold text-[var(--fg)]">
            Ignored Rules Memory ({overview.ignoredRules.length})
          </h3>
          {overview.ignoredRules.length === 0 ? (
            <p className="text-xs text-[var(--fg-muted)]">
              No rules dismissed. Dismissing an audit-backed task adds its rule ID here so the agent never re-suggests it.
            </p>
          ) : (
            <div className="space-y-1.5 text-xs">
              {overview.ignoredRules.map((ir) => (
                <div
                  key={ir.id}
                  className="flex items-center justify-between rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5"
                >
                  <span className="font-mono font-semibold text-[var(--fg)]">
                    {ir.ruleId ?? "custom-pattern"}
                  </span>
                  <span className="text-[11px] text-[var(--fg-muted)]">
                    {ir.reason}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
