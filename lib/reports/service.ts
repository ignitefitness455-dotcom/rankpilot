import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { withUserDb } from "@/lib/db/rls";
import {
  alerts,
  crawls,
  issues,
  keywords,
  reports,
  reportSchedules,
  searchPerformance,
  tasks,
} from "@/lib/db/schema";
import { assertProjectAccess, NotFoundError } from "@/lib/security/authz";

export interface ReportSummaryData {
  projectName: string;
  projectUrl: string;
  period: "weekly" | "monthly" | "custom";
  rangeStart: string;
  rangeEnd: string;
  locale: "en" | "bn";
  healthScore: number | null;
  pagesCrawled: number;
  issuesSummary: {
    critical: number;
    warning: number;
    info: number;
    fixed: number;
  };
  gscSummary: {
    clicks: number;
    impressions: number;
    avgCtrPct: number;
    avgPosition: number;
  };
  keywordsTrackedCount: number;
  tasksSummary: {
    todo: number;
    inProgress: number;
    done: number;
    approved: number;
  };
  topPriorityTasks: Array<{
    title: string;
    priority: number;
    status: string;
  }>;
  generatedAt: string;
}

export interface ReportItemDto {
  id: string;
  period: "weekly" | "monthly" | "custom";
  rangeStart: string;
  rangeEnd: string;
  status: "queued" | "running" | "ready" | "failed";
  locale: string;
  data: ReportSummaryData | null;
  html: string | null;
  createdAt: string;
}

export interface ReportScheduleDto {
  id: string;
  cadence: "weekly" | "monthly";
  day: number;
  hour: number;
  tz: string;
  recipients: string[];
  locale: string;
  active: boolean;
}

export interface AlertItemDto {
  id: string;
  kind: string;
  severity: "critical" | "warning" | "info";
  title: string;
  readAt: string | null;
  createdAt: string;
}

export interface ReportsModuleOverview {
  reports: ReportItemDto[];
  schedule: ReportScheduleDto | null;
  alerts: AlertItemDto[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Returns true when a recurring schedule should produce a new report: no prior report exists
 * for the cadence, or the latest one is older than the cadence window (7 or 30 days).
 */
export function isReportScheduleDue(params: {
  cadence: "weekly" | "monthly";
  lastReportAt: Date | null;
  now?: Date;
}): boolean {
  if (!params.lastReportAt) return true;
  const windowMs = (params.cadence === "monthly" ? 30 : 7) * 86_400_000;
  const nowMs = (params.now ?? new Date()).getTime();
  return nowMs - params.lastReportAt.getTime() >= windowMs;
}

/**
 * Renders a self-contained, print-ready HTML report (supports `@media print` for PDF export)
 * in either English (`en`) or Bengali (`bn`).
 */
export function renderExecutiveReportHtml(data: ReportSummaryData): string {
  const isBn = data.locale === "bn";
  const labels = isBn
    ? {
        title: `${escapeHtml(data.projectName)} — এক্সিকিউটিভ SEO ও GEO রিপোর্ট`,
        period: "রিপোর্ট সময়কাল",
        healthScore: "SEO হেলথ স্কোর",
        pagesCrawled: "ক্রল করা পেজ",
        gscClicks: "২৮ দিনের অর্গানিক ক্লিক",
        gscImpr: "২৮ দিনের ইমপ্রেশন",
        auditSection: "১. টেকনিক্যাল ও অন-পেজ অডিট সারাংশ",
        critical: "ক্রিটিক্যাল সমস্যা",
        warning: "সতর্কতা (Warning)",
        info: "তথ্যমূলক (Info)",
        fixed: "সমাধানকৃত (Fixed)",
        tasksSection: "২. অ্যাকশন সেন্টার ও অনুমোদিত কাজ",
        priorityCol: "অগ্রাধিকার",
        taskCol: "কাজের শিরোনাম",
        statusCol: "অবস্থা",
        footer: "RankPilot দ্বারা স্বয়ংক্রিয়ভাবে প্রস্তুতকৃত (প্রমাণ-ভিত্তিক SEO এজেন্ট)",
      }
    : {
        title: `${escapeHtml(data.projectName)} — Executive SEO & GEO Report`,
        period: "Reporting Window",
        healthScore: "SEO Health Score",
        pagesCrawled: "Pages Crawled",
        gscClicks: "28d Organic Clicks",
        gscImpr: "28d Impressions",
        auditSection: "1. Technical & On-Page Audit Summary",
        critical: "Critical Issues",
        warning: "Warnings",
        info: "Info Notices",
        fixed: "Verified Fixed",
        tasksSection: "2. Top Priority Action Center Tasks",
        priorityCol: "Priority",
        taskCol: "Task Title",
        statusCol: "Status",
        footer: "Generated deterministically by RankPilot (Evidence-First AI SEO Agent)",
      };

  const taskRowsHtml =
    data.topPriorityTasks.length > 0
      ? data.topPriorityTasks
          .map(
            (t) => `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-family:monospace;font-weight:700;color:#4f46e5;">P${t.priority}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escapeHtml(t.title)}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-family:monospace;">${escapeHtml(t.status)}</td>
          </tr>`,
          )
          .join("")
      : `<tr><td colspan="3" style="padding:12px;color:#64748b;">No open tasks recorded.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="${data.locale}">
<head>
  <meta charset="utf-8" />
  <title>${labels.title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Bengali", sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 32px;
      line-height: 1.5;
    }
    .container { max-width: 880px; margin: 0 auto; }
    .header { border-bottom: 2px solid #4f46e5; padding-bottom: 16px; margin-bottom: 24px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
    .kpi-card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px; background: #f8fafc; }
    .kpi-label { font-size: 12px; color: #475569; display: block; }
    .kpi-val { font-size: 22px; font-weight: 700; font-family: monospace; margin-top: 4px; color: #0f172a; }
    h2 { font-size: 16px; margin-top: 24px; margin-bottom: 10px; color: #1e293b; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 12px; background: #f1f5f9; border-bottom: 2px solid #cbd5e1; }
    .footer { margin-top: 36px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin:0;font-size:22px;">${labels.title}</h1>
      <p style="margin:4px 0 0;font-size:13px;color:#475569;">
        URL: <strong>${escapeHtml(data.projectUrl)}</strong> · ${labels.period}: <strong>${escapeHtml(data.rangeStart)} → ${escapeHtml(data.rangeEnd)}</strong> (${escapeHtml(data.period)})
      </p>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <span class="kpi-label">${labels.healthScore}</span>
        <div class="kpi-val">${data.healthScore !== null ? `${data.healthScore}/100` : "—"}</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">${labels.pagesCrawled}</span>
        <div class="kpi-val">${data.pagesCrawled}</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">${labels.gscClicks}</span>
        <div class="kpi-val">${data.gscSummary.clicks.toLocaleString()}</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">${labels.gscImpr}</span>
        <div class="kpi-val">${data.gscSummary.impressions.toLocaleString()}</div>
      </div>
    </div>

    <h2>${labels.auditSection}</h2>
    <div class="kpi-grid">
      <div class="kpi-card">
        <span class="kpi-label">${labels.critical}</span>
        <div class="kpi-val" style="color:#dc2626;">${data.issuesSummary.critical}</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">${labels.warning}</span>
        <div class="kpi-val" style="color:#d97706;">${data.issuesSummary.warning}</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">${labels.info}</span>
        <div class="kpi-val" style="color:#2563eb;">${data.issuesSummary.info}</div>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">${labels.fixed}</span>
        <div class="kpi-val" style="color:#16a34a;">${data.issuesSummary.fixed}</div>
      </div>
    </div>

    <h2>${labels.tasksSection}</h2>
    <table>
      <thead>
        <tr>
          <th>${labels.priorityCol}</th>
          <th>${labels.taskCol}</th>
          <th>${labels.statusCol}</th>
        </tr>
      </thead>
      <tbody>
        ${taskRowsHtml}
      </tbody>
    </table>

    <div class="footer">
      ${labels.footer} · ${escapeHtml(data.generatedAt)}
    </div>
  </div>
</body>
</html>`;
}

export async function listProjectReportsAndAlerts(
  userId: string,
  projectId: string,
): Promise<ReportsModuleOverview> {
  return withUserDb(userId, async (tx) => {
    await assertProjectAccess(tx, userId, projectId, "viewer");

    const reportRows = await tx
      .select()
      .from(reports)
      .where(eq(reports.projectId, projectId))
      .orderBy(desc(reports.createdAt))
      .limit(20);

    const [schedRow] = await tx
      .select()
      .from(reportSchedules)
      .where(eq(reportSchedules.projectId, projectId))
      .limit(1);

    const alertRows = await tx
      .select()
      .from(alerts)
      .where(eq(alerts.projectId, projectId))
      .orderBy(desc(alerts.createdAt))
      .limit(25);

    return {
      reports: reportRows.map((r) => ({
        id: r.id,
        period: r.period,
        rangeStart: r.rangeStart,
        rangeEnd: r.rangeEnd,
        status: r.status,
        locale: r.locale,
        data: (r.data as ReportSummaryData | null) ?? null,
        html: r.html,
        createdAt: r.createdAt.toISOString(),
      })),
      schedule: schedRow
        ? {
            id: schedRow.id,
            cadence: schedRow.cadence,
            day: schedRow.day,
            hour: schedRow.hour,
            tz: schedRow.tz,
            recipients: schedRow.recipients ?? [],
            locale: schedRow.locale,
            active: schedRow.active,
          }
        : null,
      alerts: alertRows.map((a) => ({
        id: a.id,
        kind: a.kind,
        severity: a.severity,
        title: a.title,
        readAt: a.readAt ? a.readAt.toISOString() : null,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  });
}

export async function generateProjectReport(params: {
  userId: string;
  projectId: string;
  period: "weekly" | "monthly" | "custom";
  locale: "en" | "bn";
}): Promise<ReportItemDto> {
  return withUserDb(params.userId, async (tx) => {
    const { project } = await assertProjectAccess(
      tx,
      params.userId,
      params.projectId,
      "editor",
    );

    const now = new Date();
    const lookbackDays = params.period === "monthly" ? 30 : 7;
    const start = new Date(now.getTime() - lookbackDays * 86_400_000);
    const rangeStart = start.toISOString().slice(0, 10);
    const rangeEnd = now.toISOString().slice(0, 10);

    const [latestCrawl] = await tx
      .select()
      .from(crawls)
      .where(eq(crawls.projectId, params.projectId))
      .orderBy(desc(crawls.createdAt))
      .limit(1);

    const issueRows = await tx
      .select({
        severity: issues.severity,
        status: issues.status,
      })
      .from(issues)
      .where(eq(issues.projectId, params.projectId));

    const openIssues = issueRows.filter(
      (i) => i.status === "open" || i.status === "regressed",
    );
    const fixedIssues = issueRows.filter((i) => i.status === "fixed");

    const [gscAgg] = await tx
      .select({
        clicks: sql<number>`coalesce(sum(${searchPerformance.clicks}), 0)::int`,
        impressions: sql<number>`coalesce(sum(${searchPerformance.impressions}), 0)::int`,
        avgCtr: sql<number>`coalesce(avg(${searchPerformance.ctr}), 0)::real`,
        avgPos: sql<number>`coalesce(avg(${searchPerformance.position}), 0)::real`,
      })
      .from(searchPerformance)
      .where(eq(searchPerformance.projectId, params.projectId));

    const trackedKws = await tx
      .select({ id: keywords.id })
      .from(keywords)
      .where(
        and(
          eq(keywords.projectId, params.projectId),
          eq(keywords.tracked, true),
        ),
      );

    const taskRows = await tx
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.projectId, params.projectId), isNull(tasks.deletedAt)),
      )
      .orderBy(desc(tasks.priority));

    const summaryData: ReportSummaryData = {
      projectName: project.name,
      projectUrl: project.url,
      period: params.period,
      rangeStart,
      rangeEnd,
      locale: params.locale,
      healthScore: latestCrawl?.healthScore ?? null,
      pagesCrawled: latestCrawl?.pagesCrawled ?? 0,
      issuesSummary: {
        critical: openIssues.filter((i) => i.severity === "critical").length,
        warning: openIssues.filter((i) => i.severity === "warning").length,
        info: openIssues.filter((i) => i.severity === "info").length,
        fixed: fixedIssues.length,
      },
      gscSummary: {
        clicks: Number(gscAgg?.clicks ?? 0),
        impressions: Number(gscAgg?.impressions ?? 0),
        avgCtrPct: Math.round(Number(gscAgg?.avgCtr ?? 0) * 1000) / 10,
        avgPosition: Math.round(Number(gscAgg?.avgPos ?? 0) * 10) / 10,
      },
      keywordsTrackedCount: trackedKws.length,
      tasksSummary: {
        todo: taskRows.filter((t) => t.status === "todo").length,
        inProgress: taskRows.filter((t) => t.status === "in_progress").length,
        done: taskRows.filter((t) => t.status === "done").length,
        approved: taskRows.filter((t) => Boolean(t.approvedAt)).length,
      },
      topPriorityTasks: taskRows.slice(0, 8).map((t) => ({
        title: t.title,
        priority: t.priority,
        status: t.status,
      })),
      generatedAt: now.toISOString(),
    };

    const html = renderExecutiveReportHtml(summaryData);

    const [inserted] = await tx
      .insert(reports)
      .values({
        projectId: params.projectId,
        period: params.period,
        rangeStart,
        rangeEnd,
        status: "ready",
        locale: params.locale,
        data: summaryData,
        html,
      })
      .returning();

    await tx.insert(alerts).values({
      projectId: params.projectId,
      kind: "report_generated",
      severity: "info",
      title: `Generated ${params.period} SEO report (${rangeStart} → ${rangeEnd}) in ${params.locale.toUpperCase()}.`,
      data: { reportId: inserted!.id },
    });

    return {
      id: inserted!.id,
      period: inserted!.period,
      rangeStart: inserted!.rangeStart,
      rangeEnd: inserted!.rangeEnd,
      status: inserted!.status,
      locale: inserted!.locale,
      data: summaryData,
      html: inserted!.html,
      createdAt: inserted!.createdAt.toISOString(),
    };
  });
}

export async function upsertProjectReportSchedule(params: {
  userId: string;
  projectId: string;
  cadence: "weekly" | "monthly";
  day: number;
  hour: number;
  tz: string;
  recipients: string[];
  locale: "en" | "bn";
  active: boolean;
}): Promise<ReportScheduleDto> {
  return withUserDb(params.userId, async (tx) => {
    await assertProjectAccess(tx, params.userId, params.projectId, "editor");

    const [existing] = await tx
      .select({ id: reportSchedules.id })
      .from(reportSchedules)
      .where(eq(reportSchedules.projectId, params.projectId))
      .limit(1);

    let saved;
    if (existing) {
      const [u] = await tx
        .update(reportSchedules)
        .set({
          cadence: params.cadence,
          day: params.day,
          hour: params.hour,
          tz: params.tz,
          recipients: params.recipients,
          locale: params.locale,
          active: params.active,
          updatedAt: new Date(),
        })
        .where(eq(reportSchedules.id, existing.id))
        .returning();
      saved = u!;
    } else {
      const [ins] = await tx
        .insert(reportSchedules)
        .values({
          projectId: params.projectId,
          cadence: params.cadence,
          day: params.day,
          hour: params.hour,
          tz: params.tz,
          recipients: params.recipients,
          locale: params.locale,
          active: params.active,
        })
        .returning();
      saved = ins!;
    }

    return {
      id: saved.id,
      cadence: saved.cadence,
      day: saved.day,
      hour: saved.hour,
      tz: saved.tz,
      recipients: saved.recipients ?? [],
      locale: saved.locale,
      active: saved.active,
    };
  });
}

export async function markProjectAlertRead(params: {
  userId: string;
  alertId: string;
}): Promise<{ id: string; readAt: string }> {
  return withUserDb(params.userId, async (tx) => {
    const [updated] = await tx
      .update(alerts)
      .set({ readAt: new Date() })
      .where(eq(alerts.id, params.alertId))
      .returning({ id: alerts.id, readAt: alerts.readAt });

    if (!updated || !updated.readAt) {
      throw new NotFoundError("Alert not found");
    }

    return {
      id: updated.id,
      readAt: updated.readAt.toISOString(),
    };
  });
}
