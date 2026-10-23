import { notFound } from "next/navigation";
import { IssueDetailClient } from "@/components/audit/issue-detail-client";
import { requireAuthUser } from "@/lib/auth";
import { getIssueDetails } from "@/lib/crawler/runner";
import { ForbiddenError, NotFoundError } from "@/lib/security/authz";

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string; issueId: string }>;
}) {
  const { projectId, issueId } = await params;
  const user = await requireAuthUser();

  let detail;
  try {
    detail = await getIssueDetails(user.id, issueId);
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) {
      notFound();
    }
    throw err;
  }

  if (!detail || detail.issue.projectId !== projectId) {
    notFound();
  }

  return (
    <IssueDetailClient
      projectId={projectId}
      issue={{
        id: detail.issue.id,
        ruleId: detail.issue.ruleId,
        category: detail.issue.category,
        severity: detail.issue.severity,
        status: detail.issue.status,
        affectedCount: detail.issue.affectedCount,
        finding: detail.issue.finding,
        ignoredReason: detail.issue.ignoredReason,
        updatedAt: detail.issue.updatedAt.toISOString(),
      }}
      instances={detail.instances.map((inst) => ({
        id: inst.id,
        crawlId: inst.crawlId,
        pageId: inst.pageId,
        evidence: inst.evidence,
      }))}
    />
  );
}
