import { notFound } from "next/navigation";
import { PagesInventoryClient } from "@/components/audit/pages-inventory-client";
import { requireAuthUser } from "@/lib/auth";
import { listProjectPages } from "@/lib/crawler/runner";
import { ForbiddenError, NotFoundError } from "@/lib/security/authz";

export default async function PagesInventoryPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await requireAuthUser();

  let result;
  try {
    result = await listProjectPages({ userId: user.id, projectId });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) {
      notFound();
    }
    throw err;
  }

  return (
    <PagesInventoryClient
      projectId={projectId}
      crawlId={result.crawlId}
      initialPages={result.pages.map((p) => ({
        id: p.id,
        url: p.url,
        finalUrl: p.finalUrl,
        statusCode: p.statusCode,
        title: p.title,
        metaDescription: p.metaDescription,
        canonical: p.canonical,
        robotsMeta: p.robotsMeta,
        wordCount: p.wordCount,
        depth: p.depth,
        inlinks: p.inlinks,
        outlinks: p.outlinks,
        ttfbMs: p.ttfbMs,
        bytes: p.bytes,
        schemaTypes: p.schemaTypes,
        injectionFlag: p.injectionFlag,
      }))}
    />
  );
}
