import { notFound } from "next/navigation";
import { ActionCenterClient } from "@/components/actions/action-center-client";
import { listProjectActionCenter } from "@/lib/actions/service";
import { requireAuthUser } from "@/lib/auth";
import { ForbiddenError, NotFoundError } from "@/lib/security/authz";

export default async function ActionCenterModulePage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await requireAuthUser();

  let initialOverview;
  try {
    initialOverview = await listProjectActionCenter(user.id, projectId);
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) {
      notFound();
    }
    throw err;
  }

  return (
    <ActionCenterClient
      projectId={projectId}
      initialOverview={initialOverview}
    />
  );
}
