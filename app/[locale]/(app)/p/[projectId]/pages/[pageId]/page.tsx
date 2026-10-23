import { notFound } from "next/navigation";
import { PageDetailClient } from "@/components/audit/page-detail-client";
import { requireAuthUser } from "@/lib/auth";
import { getPageDetails } from "@/lib/crawler/runner";
import { ForbiddenError, NotFoundError } from "@/lib/security/authz";

export default async function PageDetailPage({
  params,
}: {
  params: Promise<{ locale: string; projectId: string; pageId: string }>;
}) {
  const { projectId, pageId } = await params;
  const user = await requireAuthUser();

  let detail;
  try {
    detail = await getPageDetails(user.id, pageId);
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) {
      notFound();
    }
    throw err;
  }

  if (!detail || detail.page.projectId !== projectId) {
    notFound();
  }

  return (
    <PageDetailClient
      projectId={projectId}
      page={{
        id: detail.page.id,
        url: detail.page.url,
        finalUrl: detail.page.finalUrl,
        statusCode: detail.page.statusCode,
        redirectChain: detail.page.redirectChain,
        contentType: detail.page.contentType,
        title: detail.page.title,
        metaDescription: detail.page.metaDescription,
        canonical: detail.page.canonical,
        robotsMeta: detail.page.robotsMeta,
        xRobots: detail.page.xRobots,
        hreflang: detail.page.hreflang,
        h1: detail.page.h1,
        headings: detail.page.headings,
        wordCount: detail.page.wordCount,
        textHash: detail.page.textHash,
        depth: detail.page.depth,
        inlinks: detail.page.inlinks,
        outlinks: detail.page.outlinks,
        schemaTypes: detail.page.schemaTypes,
        schemaRaw: detail.page.schemaRaw,
        hasViewport: detail.page.hasViewport,
        lang: detail.page.lang,
        bytes: detail.page.bytes,
        ttfbMs: detail.page.ttfbMs,
        rendered: detail.page.rendered,
        injectionFlag: detail.page.injectionFlag,
        summary: detail.page.summary,
      }}
      outgoingLinks={detail.outgoingLinks}
      incomingLinks={detail.incomingLinks}
      issues={detail.issues}
    />
  );
}
