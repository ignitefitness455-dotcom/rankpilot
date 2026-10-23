import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { listProjectPages } from "@/lib/crawler/runner";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    const { id } = await params;
    const url = new URL(req.url);
    const crawlId = url.searchParams.get("crawlId") ?? undefined;
    const statusFilter = url.searchParams.get("status") ?? undefined;
    const search = url.searchParams.get("q") ?? undefined;

    const result = await listProjectPages({
      userId: user.id,
      projectId: id,
      crawlId,
      statusFilter,
      search,
    });

    return apiSuccess(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
