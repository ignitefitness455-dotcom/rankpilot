import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { listProjectRunsAndMessages } from "@/lib/ai/orchestrator";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { id: projectId } = await context.params;
    const data = await listProjectRunsAndMessages(user.id, projectId);
    return apiSuccess({ runs: data.runs });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
