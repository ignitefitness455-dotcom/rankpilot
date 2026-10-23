import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { listProjectCrawls, queueProjectCrawl } from "@/lib/crawler/runner";
import { startCrawlRequestSchema } from "@/lib/schemas/api/audit";
import { enforceRateLimit } from "@/lib/security/rate-limit";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    const { id } = await params;
    const crawlsList = await listProjectCrawls(user.id, id);
    return apiSuccess({ crawls: crawlsList });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    await enforceRateLimit("crawl_start", user.id);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = startCrawlRequestSchema.parse(body);

    const crawl = await queueProjectCrawl({
      userId: user.id,
      projectId: id,
      trigger: parsed.trigger,
      maxPages: parsed.maxPages,
      maxDepth: parsed.maxDepth,
      render: parsed.render,
      executeInBackground: true,
    });

    return apiSuccess({ crawl }, 201);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
