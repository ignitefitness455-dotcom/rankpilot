"use client";

import * as React from "react";
import { Download, KeyRound, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { signOut } from "next-auth/react";
import { Badge, Button, Card, Input, SeverityBadge } from "@/components/ui/primitives";
import type { MaskedIntegrationSummary } from "@/lib/settings/service";
import type { ByokKind } from "@/lib/schemas/api/settings";

const KEY_LABELS: Record<ByokKind, { title: string; subtitle: string; required?: boolean }> = {
  gemini_key: {
    title: "Google Gemini API Key (gemini-4-argon)",
    subtitle: "Required for Agent Chat, Content Studio, and AI Search reasoning (paid tier).",
    required: true,
  },
  serpapi: {
    title: "SerpAPI Key",
    subtitle: "Optional plug-in for live Google SERP features and competitor rank tracking.",
  },
  serper: {
    title: "Serper.dev Key",
    subtitle: "Optional low-cost SERP provider plug-in.",
  },
  dataforseo: {
    title: "DataForSEO Credentials (login:password)",
    subtitle: "Optional plug-in for real search volume and keyword metrics.",
  },
  openai: {
    title: "OpenAI API Key",
    subtitle: "Optional BYOK key for ChatGPT Search citation tracking in the GEO module.",
  },
  perplexity: {
    title: "Perplexity API Key",
    subtitle: "Optional BYOK key for Perplexity citation tracking in the GEO module.",
  },
  smtp: {
    title: "Custom SMTP URL",
    subtitle: "Optional override for scheduled report email delivery.",
  },
};

export interface SettingsClientProps {
  initialKeys: MaskedIntegrationSummary[];
  initialBudgets: {
    budgetRunUsd: number;
    budgetProjectDayUsd: number;
    budgetUserMonthUsd: number;
    useFastModel: boolean;
  };
  usage: {
    todayUsd: number;
    monthUsd: number;
    monthTokensIn: number;
    monthTokensOut: number;
  };
  strings: {
    title: string;
    subtitle: string;
    byokSectionTitle: string;
    byokSectionDesc: string;
    statusByok: string;
    statusServerEnv: string;
    statusNone: string;
    saveKey: string;
    removeKey: string;
    keyPlaceholder: string;
    budgetSectionTitle: string;
    budgetSectionDesc: string;
    budgetRunLabel: string;
    budgetProjectDayLabel: string;
    budgetUserMonthLabel: string;
    fastModelToggleLabel: string;
    saveBudgetsButton: string;
    usageSectionTitle: string;
    todaySpend: string;
    monthSpend: string;
    monthTokens: string;
    dataPrivacyTitle: string;
    exportButton: string;
    deleteAccountButton: string;
    savedToast: string;
  };
}

export function SettingsClient({
  initialKeys,
  initialBudgets,
  usage,
  strings,
}: SettingsClientProps) {
  const [keys, setKeys] = React.useState<MaskedIntegrationSummary[]>(initialKeys);
  const [draftSecrets, setDraftSecrets] = React.useState<Record<string, string>>({});
  const [savingKind, setSavingKind] = React.useState<string | null>(null);

  const [budgetRunUsd, setBudgetRunUsd] = React.useState(initialBudgets.budgetRunUsd);
  const [budgetProjectDayUsd, setBudgetProjectDayUsd] = React.useState(
    initialBudgets.budgetProjectDayUsd,
  );
  const [budgetUserMonthUsd, setBudgetUserMonthUsd] = React.useState(
    initialBudgets.budgetUserMonthUsd,
  );
  const [useFastModel, setUseFastModel] = React.useState(initialBudgets.useFastModel);
  const [savingBudgets, setSavingBudgets] = React.useState(false);

  const handleSaveKey = async (kind: ByokKind) => {
    const secret = draftSecrets[kind]?.trim();
    if (!secret) return;
    setSavingKind(kind);
    try {
      const res = await fetch(`/api/v1/settings/keys/${kind}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error?.message || "Failed to save key");
      }
      setKeys((prev) => prev.map((k) => (k.kind === kind ? json.data : k)));
      setDraftSecrets((prev) => ({ ...prev, [kind]: "" }));
      toast.success(strings.savedToast);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error saving key");
    } finally {
      setSavingKind(null);
    }
  };

  const handleRemoveKey = async (kind: ByokKind) => {
    setSavingKind(kind);
    try {
      const res = await fetch(`/api/v1/settings/keys/${kind}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove key");
      const refresh = await fetch("/api/v1/settings/keys");
      const refreshJson = await refresh.json();
      if (refreshJson.ok) setKeys(refreshJson.data);
      toast.success(strings.savedToast);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error removing key");
    } finally {
      setSavingKind(null);
    }
  };

  const handleSaveBudgets = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBudgets(true);
    try {
      const res = await fetch("/api/v1/settings/budget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budgetRunUsd,
          budgetProjectDayUsd,
          budgetUserMonthUsd,
          useFastModel,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json?.error?.message || "Failed to save budgets");
      }
      toast.success(strings.savedToast);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error saving budgets");
    } finally {
      setSavingBudgets(false);
    }
  };

  const handleExport = async () => {
    try {
      const res = await fetch("/api/v1/settings/export", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error("Export failed");
      const blob = new Blob([JSON.stringify(json.data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rankpilot-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--fg)]">{strings.title}</h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">{strings.subtitle}</p>
      </div>

      {/* Usage metering overview */}
      <Card className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--fg)]">{strings.usageSectionTitle}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3">
            <p className="text-xs text-[var(--fg-muted)]">{strings.todaySpend}</p>
            <p className="mt-1 tabular-nums text-xl font-bold text-[var(--fg)]">
              ${usage.todayUsd.toFixed(4)}
            </p>
          </div>
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3">
            <p className="text-xs text-[var(--fg-muted)]">{strings.monthSpend}</p>
            <p className="mt-1 tabular-nums text-xl font-bold text-[var(--fg)]">
              ${usage.monthUsd.toFixed(4)} / ${budgetUserMonthUsd.toFixed(2)}
            </p>
          </div>
          <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3">
            <p className="text-xs text-[var(--fg-muted)]">{strings.monthTokens}</p>
            <p className="mt-1 tabular-nums text-sm font-semibold text-[var(--fg)]">
              {usage.monthTokensIn.toLocaleString()} / {usage.monthTokensOut.toLocaleString()}
            </p>
          </div>
        </div>
      </Card>

      {/* Hard AI Budget Guardrails */}
      <Card className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--fg)]">{strings.budgetSectionTitle}</h2>
          <p className="mt-0.5 text-xs text-[var(--fg-muted)]">{strings.budgetSectionDesc}</p>
        </div>

        <form onSubmit={handleSaveBudgets} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor="budget-run" className="text-xs font-medium text-[var(--fg)]">
                {strings.budgetRunLabel}
              </label>
              <Input
                id="budget-run"
                type="number"
                step="0.05"
                min="0.05"
                max="50"
                className="tabular-nums"
                value={budgetRunUsd}
                onChange={(e) => setBudgetRunUsd(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="budget-day" className="text-xs font-medium text-[var(--fg)]">
                {strings.budgetProjectDayLabel}
              </label>
              <Input
                id="budget-day"
                type="number"
                step="0.25"
                min="0.2"
                max="500"
                className="tabular-nums"
                value={budgetProjectDayUsd}
                onChange={(e) => setBudgetProjectDayUsd(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="budget-month" className="text-xs font-medium text-[var(--fg)]">
                {strings.budgetUserMonthLabel}
              </label>
              <Input
                id="budget-month"
                type="number"
                step="1"
                min="1"
                max="5000"
                className="tabular-nums"
                value={budgetUserMonthUsd}
                onChange={(e) => setBudgetUserMonthUsd(Number(e.target.value))}
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-xs text-[var(--fg)] cursor-pointer">
            <input
              type="checkbox"
              checked={useFastModel}
              onChange={(e) => setUseFastModel(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--border-strong)]"
            />
            <span>{strings.fastModelToggleLabel}</span>
          </label>

          <Button type="submit" disabled={savingBudgets} data-testid="save-budgets-btn">
            {strings.saveBudgetsButton}
          </Button>
        </form>
      </Card>

      {/* BYOK Encrypted Keys */}
      <Card className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--fg)]">{strings.byokSectionTitle}</h2>
          <p className="mt-0.5 text-xs text-[var(--fg-muted)]">{strings.byokSectionDesc}</p>
        </div>

        <div className="divide-y divide-[var(--border)]">
          {keys.map((item) => {
            const kind = item.kind as ByokKind;
            const meta = KEY_LABELS[kind];
            if (!meta) return null;
            return (
              <div
                key={kind}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <KeyRound className="h-4 w-4 text-[var(--brand)]" />
                    <span className="text-sm font-semibold text-[var(--fg)]">{meta.title}</span>
                    {item.source === "byok" ? (
                      <SeverityBadge
                        severity="good"
                        label={strings.statusByok.replace("{last4}", item.last4 ?? "••••")}
                      />
                    ) : item.source === "server_env" ? (
                      <Badge variant="info">{strings.statusServerEnv}</Badge>
                    ) : (
                      <Badge variant="neutral">{strings.statusNone}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-[var(--fg-muted)]">{meta.subtitle}</p>
                </div>

                <div className="flex items-center gap-2 sm:w-80">
                  <Input
                    type="password"
                    aria-label={meta.title}
                    data-testid={`key-input-${kind}`}
                    placeholder={strings.keyPlaceholder}
                    value={draftSecrets[kind] ?? ""}
                    onChange={(e) =>
                      setDraftSecrets((prev) => ({ ...prev, [kind]: e.target.value }))
                    }
                  />
                  <Button
                    size="sm"
                    disabled={savingKind === kind || !(draftSecrets[kind]?.trim())}
                    onClick={() => handleSaveKey(kind)}
                    data-testid={`save-key-${kind}`}
                  >
                    {strings.saveKey}
                  </Button>
                  {item.source === "byok" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={savingKind === kind}
                      onClick={() => handleRemoveKey(kind)}
                      aria-label={`${strings.removeKey} ${meta.title}`}
                    >
                      <Trash2 className="h-4 w-4 text-[var(--critical)]" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Data Export & Account Deletion */}
      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-[var(--warning)]" />
          <h2 className="text-base font-semibold text-[var(--fg)]">{strings.dataPrivacyTitle}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={handleExport}>
            <Download className="h-4 w-4" />
            {strings.exportButton}
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!window.confirm("Delete your account and all projects permanently?")) return;
              const res = await fetch("/api/v1/settings/account", { method: "DELETE" });
              if (res.ok) {
                await signOut({ callbackUrl: "/en/sign-in" });
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
            {strings.deleteAccountButton}
          </Button>
        </div>
      </Card>
    </div>
  );
}
