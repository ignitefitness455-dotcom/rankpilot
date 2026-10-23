import { notFound } from "next/navigation";
import { AiSearchClient } from "@/components/geo/ai-search-client";
import { requireAuthUser } from "@/lib/auth";
import { getProjectGeoOverview } from "@/lib/geo/service";
import { ForbiddenError, NotFoundError } from "@/lib/security/authz";

export default async function AiSearchGeoModulePage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await requireAuthUser();

  let initialOverview;
  try {
    initialOverview = await getProjectGeoOverview(user.id, projectId);
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) {
      notFound();
    }
    throw err;
  }

  return (
    <AiSearchClient
      projectId={projectId}
      initialOverview={initialOverview}
    />
  );
}
