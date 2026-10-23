import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { cancelAgentRun } from "@/lib/ai/orchestrator";

export async function POST(
  _req: Request,
  context: { params: Promise<{ rid: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { rid } = await context.params;
    const updated = await cancelAgentRun(user.id, rid);
    return apiSuccess({ runId: updated.id, status: updated.status });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
