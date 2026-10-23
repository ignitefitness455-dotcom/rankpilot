import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ContentStudioClient } from "@/components/content/content-studio-client";
import { requireAuthUser } from "@/lib/auth";
import { listProjectContentItems } from "@/lib/content/studio";
import { withUserDb } from "@/lib/db/rls";
import { projects } from "@/lib/db/schema";
import { ForbiddenError, NotFoundError } from "@/lib/security/authz";

export default async function ContentStudioModulePage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await requireAuthUser();

  let initialItems;
  try {
    initialItems = await listProjectContentItems(user.id, projectId);
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) {
      notFound();
    }
    throw err;
  }

  const projectRow = await withUserDb(user.id, async (tx) => {
    const [p] = await tx
      .select({ name: projects.name, url: projects.url })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return p ?? null;
  });

  if (!projectRow) {
    notFound();
  }

  return (
    <ContentStudioClient
      projectId={projectId}
      projectUrl={projectRow.url}
      projectName={projectRow.name}
      initialItems={initialItems}
    />
  );
}
