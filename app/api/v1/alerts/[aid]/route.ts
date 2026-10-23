import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { markProjectAlertRead } from "@/lib/reports/service";

export async function PATCH(
  _req: Request,
  context: { params: Promise<{ aid: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { aid } = await context.params;
    const res = await markProjectAlertRead({
      userId: user.id,
      alertId: aid,
    });
    return apiSuccess(res);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
