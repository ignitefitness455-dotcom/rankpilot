import { notFound } from "next/navigation";
import { KeywordsClient } from "@/components/keywords/keywords-client";
import { requireAuthUser } from "@/lib/auth";
import { listProjectKeywords } from "@/lib/keywords/service";
import { ForbiddenError, NotFoundError } from "@/lib/security/authz";

export default async function KeywordsModulePage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await requireAuthUser();

  let initialOverview;
  try {
    initialOverview = await listProjectKeywords(user.id, projectId);
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) {
      notFound();
    }
    throw err;
  }

  return (
    <KeywordsClient
      projectId={projectId}
      initialOverview={initialOverview}
    />
  );
}
