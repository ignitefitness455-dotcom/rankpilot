import { notFound } from "next/navigation";
import { ReportsClient } from "@/components/reports/reports-client";
import { requireAuthUser } from "@/lib/auth";
import { listProjectReportsAndAlerts } from "@/lib/reports/service";
import { ForbiddenError, NotFoundError } from "@/lib/security/authz";

export default async function ReportsModulePage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await requireAuthUser();

  let initialOverview;
  try {
    initialOverview = await listProjectReportsAndAlerts(user.id, projectId);
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) {
      notFound();
    }
    throw err;
  }

  return (
    <ReportsClient
      projectId={projectId}
      initialOverview={initialOverview}
    />
  );
}
