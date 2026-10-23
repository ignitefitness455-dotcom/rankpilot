import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { compareProjectCrawls } from "@/lib/crawler/runner";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    const { id } = await params;
    const url = new URL(req.url);
    const crawlAId = url.searchParams.get("crawlA") ?? undefined;
    const crawlBId = url.searchParams.get("crawlB") ?? undefined;

    const comparison = await compareProjectCrawls({
      userId: user.id,
      projectId: id,
      crawlAId,
      crawlBId,
    });

    return apiSuccess(comparison);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
