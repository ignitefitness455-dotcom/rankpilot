import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { cancelCrawlJob } from "@/lib/crawler/runner";
import { enforceRateLimit } from "@/lib/security/rate-limit";

interface RouteParams {
  params: Promise<{ cid: string }>;
}

export async function POST(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    await enforceRateLimit("api_write", user.id);
    const { cid } = await params;
    const crawl = await cancelCrawlJob({
      userId: user.id,
      crawlId: cid,
    });
    return apiSuccess({ crawl });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
