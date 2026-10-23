"use client";

import * as React from "react";
import {
  Bot,
  CheckCircle2,
  Copy,
  FileCode2,
  Plus,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import type { ProjectGeoOverview } from "@/lib/geo/service";

export interface AiSearchClientProps {
  projectId: string;
  initialOverview: ProjectGeoOverview;
}

export function AiSearchClient({
  projectId,
  initialOverview,
}: AiSearchClientProps) {
  const [overview, setOverview] = React.useState<ProjectGeoOverview>(initialOverview);
  const [promptInput, setPromptInput] = React.useState("");
  const [selectedEngines, setSelectedEngines] = React.useState<string[]>([
    "gemini",
    "openai",
    "perplexity",
  ]);
  const [addingPrompt, setAddingPrompt] = React.useState(false);
  const [checkingVisibility, setCheckingVisibility] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  function toggleEngine(engine: string) {
    setSelectedEngines((prev) => {
      if (prev.includes(engine)) {
        return prev.length > 1 ? prev.filter((e) => e !== engine) : prev;
      }
      return [...prev, engine];
    });
  }

  async function handleAddPrompt(e: React.FormEvent) {
    e.preventDefault();
    if (!promptInput.trim()) return;
    setAddingPrompt(true);
    setToast(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/geo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptInput.trim(),
          engines: selectedEngines,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { prompt: ProjectGeoOverview["trackedPrompts"][number] };
        error?: { message?: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "Failed to add prompt");
      }
      setOverview((prev) => ({
        ...prev,
        trackedPrompts: [json.data!.prompt, ...prev.trackedPrompts],
      }));
      setPromptInput("");
      setToast("Added tracked prompt.");
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Failed to add prompt");
    } finally {
      setAddingPrompt(false);
    }
  }

  async function handleRemovePrompt(promptId: string) {
    try {
      const res = await fetch(
        `/api/v1/projects/${projectId}/geo?promptId=${encodeURIComponent(promptId)}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setOverview((prev) => ({
          ...prev,
          trackedPrompts: prev.trackedPrompts.filter((p) => p.id !== promptId),
        }));
      }
    } catch {
      // Ignore transient error
    }
  }

  async function handleRunChecks(promptId?: string) {
    setCheckingVisibility(true);
    setToast(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/geo/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: ProjectGeoOverview;
        error?: { message?: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "Visibility check failed");
      }
      setOverview(json.data);
      setToast("Completed AI Citation & Visibility checks.");
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Visibility check failed");
    } finally {
      setCheckingVisibility(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--fg)]">
            AI Search &amp; Generative Engine Optimization (GEO)
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            Verify AI crawler access (`GPTBot`, `OAI-SearchBot`, `ClaudeBot`, `PerplexityBot`, `Google-Extended`), generate `/llms.txt`, score page citation readiness, and track brand mentions across AI engines.
          </p>
        </div>

        <Badge variant="brand">
          GEO Readiness Score: {overview.overallGeoScore}/100
        </Badge>
      </div>

      {toast && (
        <div className="rounded-[8px] border border-[var(--brand)]/40 bg-[var(--brand-subtle)]/30 px-3 py-2 text-xs font-medium text-[var(--brand)]">
          {toast}
        </div>
      )}

      {/* AI Crawler Access Matrix + Robots Snippet */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-[var(--brand)]" />
              <h2 className="text-base font-semibold text-[var(--fg)]">
                AI Answer Engine Crawler Access
              </h2>
            </div>
            <Badge variant="neutral">robots.txt Evaluation</Badge>
          </div>

          <div className="divide-y divide-[var(--border)]">
            {overview.aiCrawlerStatus.map((bot) => (
              <div
                key={bot.bot}
                className="flex items-center justify-between gap-3 py-2.5 text-xs"
              >
                <div>
                  <p className="font-mono font-bold text-[var(--fg)]">
                    {bot.bot}{" "}
                    <span className="font-sans font-normal text-[var(--fg-muted)]">
                      ({bot.vendor})
                    </span>
                  </p>
                  <p className="text-[11px] text-[var(--fg-subtle)]">
                    {bot.purpose}
                  </p>
                </div>
                <Badge variant={bot.allowed ? "good" : "critical"}>
                  {bot.allowed ? "Allowed" : "Blocked"}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCode2 className="h-4 w-4 text-[var(--brand)]" />
              <h2 className="text-base font-semibold text-[var(--fg)]">
                Generated `/llms.txt` Specification File
              </h2>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(overview.llmsTxtContent);
                setToast("Copied /llms.txt markdown to clipboard.");
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy llms.txt
            </Button>
          </div>
          <pre className="max-h-64 overflow-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs text-[var(--fg)]">
            {overview.llmsTxtContent}
          </pre>
        </Card>
      </div>

      {/* Multi-Engine Prompt Visibility Tracker */}
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[var(--fg)]">
              Multi-Engine AI Prompt Visibility Tracker ({overview.trackedPrompts.length})
            </h2>
            <p className="text-xs text-[var(--fg-muted)]">
              Track high-intent buyer and informational prompts across Gemini Grounded Search, OpenAI, and Perplexity.
            </p>
          </div>

          {overview.trackedPrompts.length > 0 && (
            <Button
              size="sm"
              onClick={() => handleRunChecks()}
              disabled={checkingVisibility}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {checkingVisibility
                ? "Running Visibility Checks..."
                : "Run All Visibility Checks"}
            </Button>
          )}
        </div>

        <form
          onSubmit={handleAddPrompt}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="flex-1 space-y-1">
            <label
              htmlFor="geo-prompt-input"
              className="block text-xs font-semibold text-[var(--fg)]"
            >
              Add Target Conversational Prompt
            </label>
            <input
              id="geo-prompt-input"
              type="text"
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              placeholder="e.g. What is the best technical SEO audit tool for Next.js?"
              className="h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--fg)] focus:border-[var(--brand)] focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1.5">
            {(["gemini", "openai", "perplexity"] as const).map((eng) => {
              const active = selectedEngines.includes(eng);
              return (
                <button
                  key={eng}
                  type="button"
                  onClick={() => toggleEngine(eng)}
                  className={`h-9 rounded-[6px] border px-2.5 font-mono text-xs font-medium ${
                    active
                      ? "border-[var(--brand)] bg-[var(--brand-subtle)] text-[var(--brand)]"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--fg-muted)]"
                  }`}
                >
                  {eng}
                </button>
              );
            })}
          </div>

          <Button type="submit" size="sm" disabled={addingPrompt}>
            <Plus className="h-3.5 w-3.5" />
            {addingPrompt ? "Adding..." : "Track Prompt"}
          </Button>
        </form>

        {overview.trackedPrompts.length === 0 ? (
          <p className="py-6 text-center text-xs text-[var(--fg-muted)]">
            No tracked prompts yet. Add a conversational question above and click{" "}
            <strong className="text-[var(--fg)]">Run All Visibility Checks</strong>.
          </p>
        ) : (
          <div className="space-y-3">
            {overview.trackedPrompts.map((tp) => (
              <div
                key={tp.id}
                className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-3.5 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-[var(--fg)]">
                      &ldquo;{tp.prompt}&rdquo;
                    </span>
                    {tp.engines.map((e) => (
                      <Badge key={e} variant="neutral">
                        {e}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleRunChecks(tp.id)}
                      disabled={checkingVisibility}
                    >
                      Check Now
                    </Button>
                    <button
                      type="button"
                      aria-label="Remove prompt"
                      onClick={() => handleRemovePrompt(tp.id)}
                      className="text-[var(--fg-subtle)] hover:text-[var(--crit)]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {tp.latestChecks.length > 0 && (
                  <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
                    {tp.latestChecks.slice(0, 3).map((chk) => (
                      <div
                        key={chk.id}
                        className="rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold uppercase text-[var(--fg)]">
                            {chk.engine}
                          </span>
                          <Badge variant={chk.cited ? "good" : chk.mentioned ? "warning" : "neutral"}>
                            {chk.cited
                              ? "Cited URL"
                              : chk.mentioned
                                ? "Mentioned"
                                : "Not Cited"}
                          </Badge>
                        </div>
                        <p className="mt-1.5 line-clamp-3 text-[11px] text-[var(--fg-muted)]">
                          {chk.answerExcerpt}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Per-Page Citation Readiness Table */}
      <Card className="space-y-3">
        <h2 className="text-base font-bold text-[var(--fg)]">
          Crawled Page AI-Citation Readiness ({overview.pageReadiness.length})
        </h2>
        {overview.pageReadiness.length === 0 ? (
          <p className="text-xs text-[var(--fg-muted)]">
            Run a Site Audit first to score crawled pages for Answer-First structure, Question headings, and JSON-LD schema.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--fg-muted)]">
                  <th className="py-2 pr-3 font-semibold">Page URL</th>
                  <th className="px-3 py-2 text-center font-semibold">
                    Answer-First
                  </th>
                  <th className="px-3 py-2 text-center font-semibold">
                    Q-Headings
                  </th>
                  <th className="px-3 py-2 text-center font-semibold">
                    JSON-LD
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    GEO Score
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {overview.pageReadiness.map((pr) => (
                  <tr key={pr.pageId}>
                    <td className="py-2.5 pr-3">
                      <p className="font-mono font-semibold text-[var(--fg)]">
                        {pr.url}
                      </p>
                      {pr.recommendations[0] && (
                        <p className="text-[11px] text-[var(--fg-muted)]">
                          Tip: {pr.recommendations[0]}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {pr.signals.answerFirstOpening ? (
                        <CheckCircle2 className="mx-auto h-4 w-4 text-[var(--good)]" />
                      ) : (
                        <XCircle className="mx-auto h-4 w-4 text-[var(--warn)]" />
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono">
                      {pr.signals.questionHeadingsCount}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {pr.signals.structuredDataPresent ? (
                        <CheckCircle2 className="mx-auto h-4 w-4 text-[var(--good)]" />
                      ) : (
                        <XCircle className="mx-auto h-4 w-4 text-[var(--warn)]" />
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-[var(--brand)]">
                      {pr.score}/100
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
