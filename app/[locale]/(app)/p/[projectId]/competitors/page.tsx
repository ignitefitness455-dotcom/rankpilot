import { notFound } from "next/navigation";
import { CompetitorsClient } from "@/components/competitors/competitors-client";
import { requireAuthUser } from "@/lib/auth";
import { listProjectCompetitors } from "@/lib/competitors/service";
import { ForbiddenError, NotFoundError } from "@/lib/security/authz";

export default async function CompetitorsModulePage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await requireAuthUser();

  let initialCompetitors;
  try {
    initialCompetitors = await listProjectCompetitors(user.id, projectId);
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) {
      notFound();
    }
    throw err;
  }

  return (
    <CompetitorsClient
      projectId={projectId}
      initialCompetitors={initialCompetitors}
    />
  );
}
