import { desc, eq } from "drizzle-orm";
import {
  Activity,
  CheckSquare,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Globe,
  KeyRound,
  Search,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DashboardAuditPanel } from "@/components/audit/dashboard-audit-panel";
import { PerformanceIntelligencePanel } from "@/components/performance/performance-panel";
import { Badge, Button, Card, SeverityBadge } from "@/components/ui/primitives";
import { requireAuthUser } from "@/lib/auth";
import { listProjectCrawls, listProjectIssues } from "@/lib/crawler/runner";
import { withUserDb } from "@/lib/db/rls";
import { cwvResults } from "@/lib/db/schema";
import { getGoogleConnectionStatus } from "@/lib/google/oauth";
import { Link } from "@/lib/i18n/routing";
import { getProjectPerformanceIntelligence } from "@/lib/performance/intelligence";
import { getProjectDetail } from "@/lib/projects/service";
import { ForbiddenError, NotFoundError } from "@/lib/security/authz";

export default async function ProjectDashboardPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  const user = await requireAuthUser();

  let detail;
  try {
    detail = await getProjectDetail(user.id, projectId);
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) {
      notFound();
    }
    throw err;
  }

  const [crawlsList, issuesList, cwvList, perfReport, googleConn] = await Promise.all([
    listProjectCrawls(user.id, projectId),
    listProjectIssues({ userId: user.id, projectId }),
    withUserDb(user.id, (tx) =>
      tx
        .select()
        .from(cwvResults)
        .where(eq(cwvResults.projectId, projectId))
        .orderBy(desc(cwvResults.fetchedAt))
        .limit(10),
    ),
    getProjectPerformanceIntelligence(user.id, projectId),
    getGoogleConnectionStatus(user.id, projectId),
  ]);

  const { project, profile } = detail;
  const t = await getTranslations({ locale, namespace: "dashboard" });
  const tNav = await getTranslations({ locale, namespace: "nav" });

  const latestCrawlRow = crawlsList[0] ?? null;
  const openIssues = issuesList.filter(
    (i) => i.status === "open" || i.status === "regressed",
  );

  const modules = [
    { href: `/p/${projectId}/audit`, label: tNav("audit"), phase: "Active • Phase 2", Icon: Activity },
    { href: `/p/${projectId}/pages`, label: tNav("pages"), phase: "Active • Phase 2", Icon: FileText },
    { href: `/p/${projectId}/keywords`, label: tNav("keywords"), phase: "Phase 4", Icon: Search },
    {
      href: `/p/${projectId}/competitors`,
      label: tNav("competitors"),
      phase: "Phase 4",
      Icon: Users,
    },
    { href: `/p/${projectId}/content`, label: tNav("content"), phase: "Phase 4", Icon: Sparkles },
    { href: `/p/${projectId}/ai-search`, label: tNav("aiSearch"), phase: "Phase 5", Icon: Globe },
    {
      href: `/p/${projectId}/actions`,
      label: tNav("actions"),
      phase: "Phase 5",
      Icon: CheckSquare,
    },
    {
      href: `/p/${projectId}/reports`,
      label: tNav("reports"),
      phase: "Phase 5",
      Icon: FileSpreadsheet,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--fg)]">{project.name}</h1>
            {project.verifiedAt ? (
              <SeverityBadge severity="good" label={t("verifiedBadge")} />
            ) : (
              <SeverityBadge severity="warning" label={t("unverifiedBadge")} />
            )}
            {project.cms && <Badge variant="neutral">{project.cms}</Badge>}
          </div>
          <a
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-[var(--fg-muted)] hover:text-[var(--brand)]"
          >
            <span>{project.url}</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/p/${projectId}/settings`}>
            <Button variant="secondary" size="sm">
              <Settings className="h-3.5 w-3.5" />
              {t("editProfileCta")}
            </Button>
          </Link>
          <Link href="/settings">
            <Button variant="outline" size="sm">
              <KeyRound className="h-3.5 w-3.5" />
              {t("manageKeysCta")}
            </Button>
          </Link>
        </div>
      </div>

      {/* Live Health Score, Category Breakdown, CWV & Top 5 Fixes */}
      <DashboardAuditPanel
        projectId={projectId}
        projectUrl={project.url}
        isVerified={Boolean(project.verifiedAt)}
        latestCrawl={
          latestCrawlRow
            ? {
                id: latestCrawlRow.id,
                status: latestCrawlRow.status,
                trigger: latestCrawlRow.trigger,
                pagesFound: latestCrawlRow.pagesFound,
                pagesCrawled: latestCrawlRow.pagesCrawled,
                progress: latestCrawlRow.progress,
                healthScore: latestCrawlRow.healthScore,
                scoreBreakdown: latestCrawlRow.scoreBreakdown,
                createdAt: latestCrawlRow.createdAt.toISOString(),
                finishedAt: latestCrawlRow.finishedAt
                  ? latestCrawlRow.finishedAt.toISOString()
                  : null,
                error: latestCrawlRow.error,
              }
            : null
        }
        openIssues={openIssues.map((i) => ({
          id: i.id,
          ruleId: i.ruleId,
          category: i.category,
          severity: i.severity,
          status: i.status,
          affectedCount: i.affectedCount,
          finding: i.finding,
        }))}
        cwvRows={cwvList.map((c) => ({
          id: c.id,
          url: c.url,
          strategy: c.strategy,
          source: c.source,
          lcpMs: c.lcpMs,
          inpMs: c.inpMs,
          cls: c.cls,
          fcpMs: c.fcpMs,
          ttfbMs: c.ttfbMs,
          perfScore: c.perfScore,
          fetchedAt: c.fetchedAt.toISOString(),
        }))}
        labels={{
          healthScoreTitle: t("healthScoreTitle"),
          noCrawlYet: t("noCrawlYet"),
          noCrawlDesc: t("noCrawlDesc"),
          runAuditButton: t("runAuditButton"),
          runningAuditLabel: t("runningAuditLabel"),
          cancelAuditButton: t("cancelAuditButton"),
          topFixesTitle: t("topFixesTitle"),
          viewAllIssues: t("viewAllIssues"),
          cwvTitle: t("cwvTitle"),
          refreshCwvButton: t("refreshCwvButton"),
        }}
      />

      {/* Search Console & GA4 Performance Intelligence (Phase 3) */}
      <PerformanceIntelligencePanel
        projectId={projectId}
        initialReport={perfReport}
        oauthConnected={googleConn.connected}
      />

      {/* Agent Memory & Cached Prefix */}
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--fg)]">{t("profileCardTitle")}</h2>
          <Badge variant="brand">
            {t("profileVersion", { version: profile?.version ?? 1 })}
          </Badge>
        </div>
        <pre
          data-testid="dashboard-profile-preview"
          className="max-h-40 overflow-x-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs leading-relaxed text-[var(--fg)]"
        >
          {profile?.profileText}
        </pre>
      </Card>

      {/* Workspace Modules */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--fg)]">{t("quickLinksTitle")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {modules.map(({ href, label, phase, Icon }) => (
            <Link key={href} href={href}>
              <Card className="flex items-center justify-between p-4 transition-colors hover:border-[var(--brand)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-[var(--brand-subtle)] text-[var(--brand)]">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--fg)]">{label}</p>
                    <p className="text-[11px] text-[var(--fg-subtle)]">{phase}</p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
