"use client";

import * as React from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  ExternalLink,
  KeyRound,
  Loader2,
  Send,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { useLocale } from "next-intl";
import { toast } from "sonner";
import { Link } from "@/lib/i18n/routing";
import { Badge, Button, Input } from "@/components/ui/primitives";
import type { AgentName } from "@/lib/ai/tools";
import type {
  AgentEvidenceItem,
  AgentProposedAction,
} from "@/lib/ai/orchestrator";

export interface AgentDrawerStrings {
  title: string;
  modelBadge: string;
  close: string;
  phaseNoticeTitle: string;
  phaseNoticeBody: string;
  cachedPrefixReady: string;
  budgetCapLabel: string;
  ConfigureKeyCta: string;
  inputPlaceholder: string;
}

interface StepTraceItem {
  idx: number;
  type: "plan" | "tool_call" | "tool_result" | "message" | "verify" | "error";
  summary: string;
  toolName?: string | null;
  tokens: number;
  costUsd: number;
  durationMs: number;
  status: "ok" | "error" | "blocked";
}

interface ChatRunItem {
  id: string;
  agent: string;
  status: string;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costUsd: number;
  budgetUsd: number;
  steps: StepTraceItem[];
}

interface ChatMessageItem {
  id: string;
  runId: string;
  role: "user" | "assistant";
  content: string;
  evidence: AgentEvidenceItem[];
  actions: AgentProposedAction[];
  createdAt: string;
}

const SPECIALIST_OPTIONS: Array<{ value: AgentName; label: string }> = [
  { value: "Orchestrator", label: "Auto (Orchestrator)" },
  { value: "Technical", label: "Technical Auditor" },
  { value: "Performance", label: "Performance & GSC" },
  { value: "OnPage", label: "On-Page Optimizer" },
  { value: "Keyword", label: "Keyword Strategist" },
  { value: "Schema", label: "Schema Architect" },
  { value: "GEO", label: "AI Search / GEO" },
];

const STARTER_PROMPTS = [
  "What are my top technical SEO issues and exact fixes?",
  "Find my Search Console quick-win keywords (positions 4–20).",
  "Which pages are suffering from content decay or cannibalization?",
  "Audit my homepage title, meta description, and heading structure.",
];

export function AgentDrawer({
  open,
  onClose,
  activeProjectId,
  budgetRunUsd,
  profileVersion,
  strings,
}: {
  open: boolean;
  onClose: () => void;
  activeProjectId?: string | null;
  budgetRunUsd: number;
  profileVersion: number | null;
  strings: AgentDrawerStrings;
}) {
  const locale = useLocale();
  const [selectedAgent, setSelectedAgent] = React.useState<AgentName>("Orchestrator");
  const [promptText, setPromptText] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [messages, setMessages] = React.useState<ChatMessageItem[]>([]);
  const [runsById, setRunsById] = React.useState<Record<string, ChatRunItem>>({});
  const [expandedRunSteps, setExpandedRunSteps] = React.useState<Record<string, boolean>>({});
  const [actionBusyId, setActionBusyId] = React.useState<string | null>(null);
  const tempSeqRef = React.useRef(0);

  React.useEffect(() => {
    if (!open || !activeProjectId) return;
    let cancelled = false;
    void fetch(`/api/v1/projects/${activeProjectId}/agent/chat`)
      .then((res) => res.json())
      .then(
        (json: {
          ok: boolean;
          data?: {
            runs: ChatRunItem[];
            messages: ChatMessageItem[];
          };
        }) => {
          if (cancelled || !json.ok || !json.data) return;
          setMessages(json.data.messages);
          const map: Record<string, ChatRunItem> = {};
          for (const r of json.data.runs) {
            map[r.id] = r;
          }
          setRunsById(map);
        },
      )
      .catch(() => {
        // Ignore transient network errors
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeProjectId]);

  const sendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || !activeProjectId || submitting) return;

    setSubmitting(true);
    setPromptText("");
    tempSeqRef.current += 1;

    const optimisticUserMsg: ChatMessageItem = {
      id: `temp-${tempSeqRef.current}`,
      runId: "pending",
      role: "user",
      content: trimmed,
      evidence: [],
      actions: [],
      createdAt: "",
    };
    setMessages((prev) => [...prev, optimisticUserMsg]);

    try {
      const res = await fetch(`/api/v1/projects/${activeProjectId}/agent/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          agent: selectedAgent,
          locale: locale === "bn" ? "bn" : "en",
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: {
          runId: string;
          agent: AgentName;
          status: string;
          assistantMessage: {
            id: string;
            content: string;
            evidence: AgentEvidenceItem[];
            actions: AgentProposedAction[];
            createdAt: string;
          };
          steps: StepTraceItem[];
          metrics: {
            tokensIn: number;
            tokensOut: number;
            tokensCached: number;
            costUsd: number;
            budgetUsd: number;
          };
        };
        error?: { message?: string };
      };

      if (!json.ok || !json.data) {
        toast.error(json.error?.message ?? "Agent request failed");
        return;
      }

      const d = json.data;
      setRunsById((prev) => ({
        ...prev,
        [d.runId]: {
          id: d.runId,
          agent: d.agent,
          status: d.status,
          tokensIn: d.metrics.tokensIn,
          tokensOut: d.metrics.tokensOut,
          tokensCached: d.metrics.tokensCached,
          costUsd: d.metrics.costUsd,
          budgetUsd: d.metrics.budgetUsd,
          steps: d.steps,
        },
      }));
      setExpandedRunSteps((prev) => ({ ...prev, [d.runId]: true }));

      setMessages((prev) => [
        ...prev.map((m) => (m.id === optimisticUserMsg.id ? { ...m, runId: d.runId } : m)),
        {
          id: d.assistantMessage.id,
          runId: d.runId,
          role: "assistant",
          content: d.assistantMessage.content,
          evidence: d.assistantMessage.evidence,
          actions: d.assistantMessage.actions,
          createdAt: d.assistantMessage.createdAt,
        },
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleActionDecision = async (
    runId: string,
    actionId: string,
    decision: "approve" | "dismiss",
  ) => {
    setActionBusyId(actionId);
    try {
      const res = await fetch(`/api/v1/runs/${runId}/actions/${actionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: {
          decision: string;
          action: AgentProposedAction;
          taskId: string | null;
        };
        error?: { message?: string };
      };

      if (!json.ok || !json.data) {
        toast.error(json.error?.message ?? "Failed to record decision");
        return;
      }

      setMessages((prev) =>
        prev.map((m) => {
          if (m.runId !== runId) return m;
          return {
            ...m,
            actions: m.actions.map((a) => (a.id === actionId ? json.data!.action : a)),
          };
        }),
      );

      if (decision === "approve") {
        toast.success("Action approved and added to Action Center");
      } else {
        toast.info("Suggestion dismissed and added to ignored rules");
      }
    } catch {
      toast.error("Failed to submit approval decision");
    } finally {
      setActionBusyId(null);
    }
  };

  if (!open) return null;

  return (
    <aside
      aria-label={strings.title}
      data-testid="agent-drawer-panel"
      className="fixed inset-y-0 end-0 z-40 flex w-full max-w-md flex-col border-s border-[var(--border)] bg-[var(--surface-elevated)] shadow-xl lg:static lg:w-[420px] lg:shadow-none"
    >
      {/* Header */}
      <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[var(--brand-subtle)] text-[var(--brand)]">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--fg)]">{strings.title}</h2>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] text-[var(--fg-subtle)]">
                {strings.modelBadge}
              </span>
              <span className="text-[var(--fg-subtle)]">•</span>
              <span className="tabular-nums text-[11px] text-[var(--fg-muted)]">
                {strings.budgetCapLabel}: ${budgetRunUsd.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={strings.close}
          className="rounded-[8px] p-1.5 text-[var(--fg-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--fg)]"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* Specialist selector & status strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2">
        <div className="flex items-center gap-1.5">
          <Badge variant="good">
            <CheckCircle2 className="h-3 w-3" />
            <span>
              {strings.cachedPrefixReady}
              {profileVersion ? ` (v${profileVersion})` : ""}
            </span>
          </Badge>
          <Badge variant="info">
            <ShieldCheck className="h-3 w-3" />
            <span>White-Hat Gate</span>
          </Badge>
        </div>

        <label className="sr-only" htmlFor="agent-specialist-select">
          Specialist Agent
        </label>
        <select
          id="agent-specialist-select"
          data-testid="agent-specialist-select"
          value={selectedAgent}
          onChange={(e) => setSelectedAgent(e.target.value as AgentName)}
          className="h-7 rounded-[6px] border border-[var(--border-strong)] bg-[var(--surface-elevated)] px-2 text-[11px] font-medium text-[var(--fg)]"
        >
          {SPECIALIST_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Scrollable conversation body */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {!activeProjectId ? (
          <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4 text-xs text-[var(--fg-muted)]">
            Create or select a project first to ask the SEO Agent.
          </div>
        ) : messages.length === 0 ? (
          <div className="space-y-3">
            <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--fg)]">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--brand)]" />
                  Evidence-First SEO Agent
                </span>
                <Link href="/settings">
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--brand)] hover:underline">
                    <KeyRound className="h-3 w-3" />
                    {strings.ConfigureKeyCta}
                  </span>
                </Link>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--fg-muted)]">
                Ask any question about your crawl, Core Web Vitals, Search Console quick wins, or
                on-page fixes. Every claim is backed by tool evidence and requires your approval
                before creating tasks.
              </p>
            </div>

            <div className="space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
                Suggested Questions
              </p>
              {STARTER_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void sendMessage(q)}
                  disabled={submitting}
                  className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-start text-xs text-[var(--fg)] transition-colors hover:border-[var(--brand)] hover:bg-[var(--brand-subtle)]/40"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const run = runsById[msg.runId];
            const stepsExpanded = Boolean(expandedRunSteps[msg.runId]);

            if (msg.role === "user") {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-[12px] bg-[var(--brand)] px-3.5 py-2.5 text-xs leading-relaxed text-white">
                    {msg.content}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                data-testid="agent-assistant-message"
                className="space-y-2.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3.5"
              >
                {/* Run timeline collapsible header */}
                {run && (
                  <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface-elevated)] p-2">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedRunSteps((prev) => ({
                          ...prev,
                          [msg.runId]: !prev[msg.runId],
                        }))
                      }
                      className="flex w-full items-center justify-between text-start text-[11px]"
                    >
                      <span className="flex items-center gap-1.5 font-medium text-[var(--fg)]">
                        {stepsExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 text-[var(--fg-muted)]" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-[var(--fg-muted)]" />
                        )}
                        <Wrench className="h-3 w-3 text-[var(--brand)]" />
                        <span>
                          {run.agent} • {run.steps?.length ?? 0} steps
                        </span>
                      </span>
                      <span className="flex items-center gap-2 font-mono text-[10px] text-[var(--fg-muted)] tabular-nums">
                        <span>{run.tokensIn + run.tokensOut} tok</span>
                        {run.tokensCached > 0 && (
                          <span className="text-[var(--good)]">
                            ({run.tokensCached} cached)
                          </span>
                        )}
                        <span className="inline-flex items-center gap-0.5">
                          <Coins className="h-2.5 w-2.5" />${run.costUsd.toFixed(4)}
                        </span>
                      </span>
                    </button>

                    {stepsExpanded && run.steps && run.steps.length > 0 && (
                      <ol className="mt-2 space-y-1.5 border-t border-[var(--border)] pt-2 text-[11px]">
                        {run.steps.map((s) => (
                          <li
                            key={`${msg.runId}-step-${s.idx}`}
                            className="flex items-start justify-between gap-2 text-[var(--fg-muted)]"
                          >
                            <div className="flex items-start gap-1.5">
                              {s.status === "blocked" ? (
                                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-[var(--warning)]" />
                              ) : s.status === "error" ? (
                                <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-[var(--critical)]" />
                              ) : (
                                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-[var(--good)]" />
                              )}
                              <span>
                                <strong className="font-mono text-[10px] uppercase text-[var(--fg)]">
                                  [{s.type}]
                                </strong>{" "}
                                {s.summary}
                              </span>
                            </div>
                            <span className="shrink-0 font-mono text-[10px] text-[var(--fg-subtle)] tabular-nums">
                              <Clock className="me-0.5 inline h-2.5 w-2.5" />
                              {s.durationMs}ms
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}

                {/* Answer content */}
                <div className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--fg)]">
                  {msg.content}
                </div>

                {/* Evidence Citations */}
                {msg.evidence && msg.evidence.length > 0 && (
                  <div className="space-y-1.5 border-t border-[var(--border)] pt-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
                      Measured Evidence ({msg.evidence.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {msg.evidence.map((ev, idx) => (
                        <div
                          key={`${msg.id}-ev-${idx}`}
                          className="inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1 text-[11px]"
                        >
                          <span className="font-mono text-[10px] font-semibold uppercase text-[var(--brand)]">
                            {ev.source}
                          </span>
                          <span className="text-[var(--fg)]">{ev.label}:</span>
                          <span className="font-mono text-[var(--fg-muted)]">{ev.value}</span>
                          {ev.isEstimate && (
                            <Badge variant="warning">est</Badge>
                          )}
                          {ev.url && (
                            <a
                              href={ev.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[var(--fg-subtle)] hover:text-[var(--brand)]"
                              title={ev.url}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Human Approval Gate Proposed Actions */}
                {msg.actions && msg.actions.length > 0 && (
                  <div className="space-y-2 border-t border-[var(--border)] pt-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
                      Proposed Fixes — Human Approval Required
                    </p>
                    {msg.actions.map((act) => (
                      <div
                        key={act.id}
                        data-testid="agent-proposed-action"
                        className="space-y-2 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface-elevated)] p-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-[var(--fg)]">{act.title}</p>
                            <p className="mt-0.5 text-[11px] text-[var(--fg-muted)]">
                              {act.description}
                            </p>
                          </div>
                          <Badge
                            variant={
                              act.status === "approved"
                                ? "good"
                                : act.status === "dismissed"
                                  ? "neutral"
                                  : "brand"
                            }
                          >
                            {act.status}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-[var(--fg-subtle)]">
                          <span>Impact: {act.impact}/5</span>
                          <span>•</span>
                          <span>Effort: {act.effort}/5</span>
                          <span>•</span>
                          <span>Confidence: {Math.round(act.confidence * 100)}%</span>
                        </div>

                        {act.fixSnippet && (
                          <pre className="max-h-28 overflow-x-auto rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-2 font-mono text-[10px] text-[var(--fg)]">
                            {act.fixSnippet}
                          </pre>
                        )}

                        {act.status === "pending" && (
                          <div className="flex items-center gap-2 pt-1">
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={actionBusyId === act.id}
                              onClick={() =>
                                void handleActionDecision(msg.runId, act.id, "approve")
                              }
                            >
                              <Check className="h-3.5 w-3.5" />
                              Approve & Create Task
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={actionBusyId === act.id}
                              onClick={() =>
                                void handleActionDecision(msg.runId, act.id, "dismiss")
                              }
                            >
                              Dismiss
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

        {submitting && (
          <div className="flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--fg-muted)]">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--brand)]" />
            <span>
              {selectedAgent} is inspecting project evidence and verifying citations…
            </span>
          </div>
        )}
      </div>

      {/* Footer input */}
      <footer className="border-t border-[var(--border)] p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(promptText);
          }}
          className="flex items-center gap-2"
        >
          <Input
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            disabled={!activeProjectId || submitting}
            placeholder={strings.inputPlaceholder}
            aria-label={strings.inputPlaceholder}
            data-testid="agent-chat-input"
          />
          <Button
            type="submit"
            disabled={!activeProjectId || submitting || !promptText.trim()}
            size="sm"
            data-testid="agent-chat-submit"
          >
            <Send className="h-3.5 w-3.5" />
            <span>Send</span>
          </Button>
        </form>
      </footer>
    </aside>
  );
}
