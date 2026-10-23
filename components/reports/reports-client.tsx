"use client";

import * as React from "react";
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  Copy,
  FileBarChart2,
  Printer,
  Sparkles,
} from "lucide-react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import type {
  ReportItemDto,
  ReportsModuleOverview,
} from "@/lib/reports/service";

export interface ReportsClientProps {
  projectId: string;
  initialOverview: ReportsModuleOverview;
}

export function ReportsClient({
  projectId,
  initialOverview,
}: ReportsClientProps) {
  const [overview, setOverview] =
    React.useState<ReportsModuleOverview>(initialOverview);
  const [selectedReportId, setSelectedReportId] = React.useState<string | null>(
    initialOverview.reports[0]?.id ?? null,
  );
  const [period, setPeriod] = React.useState<"weekly" | "monthly">("weekly");
  const [locale, setLocale] = React.useState<"en" | "bn">("en");
  const [generating, setGenerating] = React.useState(false);

  // Schedule state
  const [cadence, setCadence] = React.useState<"weekly" | "monthly">(
    initialOverview.schedule?.cadence ?? "weekly",
  );
  const [recipientsInput, setRecipientsInput] = React.useState(
    (initialOverview.schedule?.recipients ?? []).join(", "),
  );
  const [scheduleLocale, setScheduleLocale] = React.useState<"en" | "bn">(
    (initialOverview.schedule?.locale as "en" | "bn") ?? "en",
  );
  const [scheduleActive, setScheduleActive] = React.useState(
    initialOverview.schedule?.active ?? true,
  );
  const [savingSchedule, setSavingSchedule] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  const selectedReport: ReportItemDto | null = React.useMemo(
    () =>
      overview.reports.find((r) => r.id === selectedReportId) ??
      overview.reports[0] ??
      null,
    [overview.reports, selectedReportId],
  );

  async function handleGenerateReport(e: React.FormEvent) {
    e.preventDefault();
    setGenerating(true);
    setToast(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, locale }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { report: ReportItemDto };
        error?: { message?: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "Failed to generate report");
      }
      const created = json.data.report;
      setOverview((prev) => ({
        ...prev,
        reports: [created, ...prev.reports],
      }));
      setSelectedReportId(created.id);
      setToast(
        `Generated ${created.period} executive report in ${created.locale.toUpperCase()}.`,
      );
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Report generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveSchedule(e: React.FormEvent) {
    e.preventDefault();
    setSavingSchedule(true);
    setToast(null);
    try {
      const recipients = recipientsInput
        .split(",")
        .map((r) => r.trim())
        .filter((r) => r.includes("@"));

      const res = await fetch(`/api/v1/projects/${projectId}/reports`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cadence,
          day: 1,
          hour: 9,
          tz: "Asia/Dhaka",
          recipients,
          locale: scheduleLocale,
          active: scheduleActive,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { schedule: ReportsModuleOverview["schedule"] };
        error?: { message?: string };
      };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.error?.message ?? "Failed to save schedule");
      }
      setOverview((prev) => ({
        ...prev,
        schedule: json.data!.schedule,
      }));
      setToast("Saved automated report schedule.");
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Schedule update failed");
    } finally {
      setSavingSchedule(false);
    }
  }

  async function handleMarkAlertRead(alertId: string) {
    try {
      const res = await fetch(`/api/v1/alerts/${alertId}`, {
        method: "PATCH",
      });
      if (res.ok) {
        setOverview((prev) => ({
          ...prev,
          alerts: prev.alerts.map((a) =>
            a.id === alertId ? { ...a, readAt: new Date().toISOString() } : a,
          ),
        }));
      }
    } catch {
      // Ignore transient error
    }
  }

  function handlePrintReport(html: string) {
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (win) {
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--fg)]">
          Executive SEO Reports, Schedules &amp; Alerts
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          Generate bilingual (English &amp; বাংলা) weekly or monthly SEO &amp; GEO reports, export print-ready HTML/PDF, and configure recurring delivery.
        </p>
      </div>

      {toast && (
        <div className="rounded-[8px] border border-[var(--brand)]/40 bg-[var(--brand-subtle)]/30 px-3 py-2 text-xs font-medium text-[var(--brand)]">
          {toast}
        </div>
      )}

      {/* Generator & Schedule Row */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="space-y-4">
          <div className="flex items-center gap-2">
            <FileBarChart2 className="h-4 w-4 text-[var(--brand)]" />
            <h2 className="text-base font-bold text-[var(--fg)]">
              Generate On-Demand Executive Report
            </h2>
          </div>

          <form onSubmit={handleGenerateReport} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[var(--fg)]">
                  Reporting Window
                </label>
                <select
                  value={period}
                  onChange={(e) =>
                    setPeriod(e.target.value as "weekly" | "monthly")
                  }
                  className="h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--fg)]"
                >
                  <option value="weekly">Weekly Digest (Last 7 Days)</option>
                  <option value="monthly">Monthly Rollup (Last 30 Days)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[var(--fg)]">
                  Report Language
                </label>
                <select
                  value={locale}
                  onChange={(e) => setLocale(e.target.value as "en" | "bn")}
                  className="h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--fg)]"
                >
                  <option value="en">English (EN)</option>
                  <option value="bn">বাংলা (BN)</option>
                </select>
              </div>
            </div>

            <Button type="submit" disabled={generating}>
              <Sparkles className="h-4 w-4" />
              {generating
                ? "Compiling Executive Report..."
                : "Generate Executive Report"}
            </Button>
          </form>
        </Card>

        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-[var(--brand)]" />
              <h2 className="text-base font-bold text-[var(--fg)]">
                Automated Report Schedule
              </h2>
            </div>
            <Badge variant={scheduleActive ? "good" : "neutral"}>
              {scheduleActive ? "Active" : "Paused"}
            </Badge>
          </div>

          <form onSubmit={handleSaveSchedule} className="space-y-3 text-xs">
            <div className="grid gap-3 sm:grid-cols-3">
              <select
                aria-label="Cadence"
                value={cadence}
                onChange={(e) =>
                  setCadence(e.target.value as "weekly" | "monthly")
                }
                className="h-9 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs text-[var(--fg)]"
              >
                <option value="weekly">Weekly (Mondays 09:00)</option>
                <option value="monthly">Monthly (1st of Month)</option>
              </select>

              <select
                aria-label="Schedule language"
                value={scheduleLocale}
                onChange={(e) =>
                  setScheduleLocale(e.target.value as "en" | "bn")
                }
                className="h-9 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs text-[var(--fg)]"
              >
                <option value="en">English (EN)</option>
                <option value="bn">বাংলা (BN)</option>
              </select>

              <label className="inline-flex items-center gap-2 font-medium text-[var(--fg)]">
                <input
                  type="checkbox"
                  checked={scheduleActive}
                  onChange={(e) => setScheduleActive(e.target.checked)}
                />
                Enable Schedule
              </label>
            </div>

            <input
              type="text"
              value={recipientsInput}
              onChange={(e) => setRecipientsInput(e.target.value)}
              placeholder="Recipient emails (comma-separated, e.g. team@example.com)"
              className="h-9 w-full rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 text-xs text-[var(--fg)]"
            />

            <Button type="submit" size="sm" variant="secondary" disabled={savingSchedule}>
              {savingSchedule ? "Saving..." : "Save Schedule"}
            </Button>
          </form>
        </Card>
      </div>

      {/* Generated Reports Viewer */}
      {selectedReport && selectedReport.data && (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[var(--fg)]">
                Report Preview: {selectedReport.rangeStart} →{" "}
                {selectedReport.rangeEnd}
              </h2>
              <Badge variant="brand">
                {selectedReport.period.toUpperCase()} ·{" "}
                {selectedReport.locale.toUpperCase()}
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {overview.reports.length > 1 && (
                <select
                  aria-label="Select historical report"
                  value={selectedReport.id}
                  onChange={(e) => setSelectedReportId(e.target.value)}
                  className="h-8 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--fg)]"
                >
                  {overview.reports.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.rangeStart} → {r.rangeEnd} ({r.locale.toUpperCase()})
                    </option>
                  ))}
                </select>
              )}

              {selectedReport.html && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void navigator.clipboard.writeText(selectedReport.html!);
                      setToast("Copied print-ready HTML report to clipboard.");
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy HTML
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handlePrintReport(selectedReport.html!)}
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Print / Save as PDF
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3">
              <span className="text-xs text-[var(--fg-muted)]">
                SEO Health Score
              </span>
              <p className="mt-1 font-mono text-xl font-bold text-[var(--brand)]">
                {selectedReport.data.healthScore ?? "—"}/100
              </p>
            </div>
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3">
              <span className="text-xs text-[var(--fg-muted)]">
                Open Issues (Crit / Warn)
              </span>
              <p className="mt-1 font-mono text-xl font-bold text-[var(--fg)]">
                {selectedReport.data.issuesSummary.critical} /{" "}
                {selectedReport.data.issuesSummary.warning}
              </p>
            </div>
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3">
              <span className="text-xs text-[var(--fg-muted)]">
                28d Clicks / Impressions
              </span>
              <p className="mt-1 font-mono text-xl font-bold text-[var(--fg)]">
                {selectedReport.data.gscSummary.clicks.toLocaleString()} /{" "}
                {selectedReport.data.gscSummary.impressions.toLocaleString()}
              </p>
            </div>
            <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3">
              <span className="text-xs text-[var(--fg-muted)]">
                Approved Action Tasks
              </span>
              <p className="mt-1 font-mono text-xl font-bold text-[var(--good)]">
                {selectedReport.data.tasksSummary.approved}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Alerts & Anomaly Feed */}
      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-[var(--brand)]" />
          <h2 className="text-base font-bold text-[var(--fg)]">
            Project Alerts &amp; Report Notifications ({overview.alerts.length})
          </h2>
        </div>

        {overview.alerts.length === 0 ? (
          <p className="text-xs text-[var(--fg-muted)]">
            No alerts recorded for this project yet.
          </p>
        ) : (
          <div className="divide-y divide-[var(--border)] text-xs">
            {overview.alerts.map((al) => (
              <div
                key={al.id}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      al.severity === "critical"
                        ? "critical"
                        : al.severity === "warning"
                          ? "warning"
                          : "info"
                    }
                  >
                    {al.severity}
                  </Badge>
                  <span
                    className={
                      al.readAt
                        ? "text-[var(--fg-muted)]"
                        : "font-semibold text-[var(--fg)]"
                    }
                  >
                    {al.title}
                  </span>
                </div>
                {!al.readAt && (
                  <button
                    type="button"
                    onClick={() => handleMarkAlertRead(al.id)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--brand)] hover:underline"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    Mark read
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
