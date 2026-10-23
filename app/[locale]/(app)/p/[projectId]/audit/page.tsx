import { notFound } from "next/navigation";
import { SiteAuditClient } from "@/components/audit/site-audit-client";
import { requireAuthUser } from "@/lib/auth";
import {
  compareProjectCrawls,
  listProjectCrawls,
  listProjectIssues,
} from "@/lib/crawler/runner";
import { getProjectDetail } from "@/lib/projects/service";
import { ForbiddenError, NotFoundError } from "@/lib/security/authz";

export default async function SiteAuditPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { projectId } = await params;
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

  const [crawlsList, issuesList, diff] = await Promise.all([
    listProjectCrawls(user.id, projectId),
    listProjectIssues({ userId: user.id, projectId }),
    compareProjectCrawls({ userId: user.id, projectId }),
  ]);

  return (
    <SiteAuditClient
      projectId={projectId}
      isVerified={Boolean(detail.project.verifiedAt)}
      initialCrawls={crawlsList.map((c) => ({
        id: c.id,
        status: c.status,
        trigger: c.trigger,
        pagesFound: c.pagesFound,
        pagesCrawled: c.pagesCrawled,
        progress: c.progress,
        healthScore: c.healthScore,
        scoreBreakdown: c.scoreBreakdown,
        createdAt: c.createdAt.toISOString(),
        finishedAt: c.finishedAt ? c.finishedAt.toISOString() : null,
        error: c.error,
      }))}
      initialIssues={issuesList.map((i) => ({
        id: i.id,
        ruleId: i.ruleId,
        category: i.category,
        severity: i.severity,
        status: i.status,
        affectedCount: i.affectedCount,
        finding: i.finding,
      }))}
      comparison={{
        scoreDelta: diff.scoreDelta,
        newIssuesCount: diff.newIssues.length,
        fixedIssuesCount: diff.fixedIssues.length,
        regressedIssuesCount: diff.regressedIssues.length,
      }}
    />
  );
}
