import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { getRunDetailWithSteps } from "@/lib/ai/orchestrator";

export async function GET(
  _req: Request,
  context: { params: Promise<{ rid: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { rid } = await context.params;
    const data = await getRunDetailWithSteps(user.id, rid);
    return apiSuccess(data);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
