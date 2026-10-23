import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { listProjectIssues } from "@/lib/crawler/runner";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    const { id } = await params;
    const url = new URL(req.url);
    const category = url.searchParams.get("category") ?? undefined;
    const severity = url.searchParams.get("severity") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;

    const issues = await listProjectIssues({
      userId: user.id,
      projectId: id,
      category,
      severity,
      status,
    });

    return apiSuccess({ issues });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
