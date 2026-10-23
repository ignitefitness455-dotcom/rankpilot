import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { queryOrSyncGa4Report } from "@/lib/google/ga4";
import { getGoogleConnectionStatus } from "@/lib/google/oauth";
import { getProjectPerformanceIntelligence } from "@/lib/performance/intelligence";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { id: projectId } = await context.params;

    const [connection, intelligence, ga4] = await Promise.all([
      getGoogleConnectionStatus(user.id, projectId),
      getProjectPerformanceIntelligence(user.id, projectId),
      queryOrSyncGa4Report({ userId: user.id, projectId, days: 28 }),
    ]);

    return apiSuccess({
      connection,
      intelligence,
      ga4,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
