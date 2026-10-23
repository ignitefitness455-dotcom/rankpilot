import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { syncProjectSearchConsole } from "@/lib/google/gsc";
import { queryOrSyncGa4Report } from "@/lib/google/ga4";
import { getProjectPerformanceIntelligence } from "@/lib/performance/intelligence";
import { syncGscRequestSchema } from "@/lib/schemas/api/performance";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    await enforceRateLimit("api_write", user.id);

    const { id: projectId } = await context.params;
    const rawBody = await req.json().catch(() => ({}));
    const parsed = syncGscRequestSchema.parse(rawBody);

    const [syncResult] = await Promise.all([
      syncProjectSearchConsole({
        userId: user.id,
        projectId,
        days: parsed.days,
      }),
      queryOrSyncGa4Report({
        userId: user.id,
        projectId,
        days: 28,
      }),
    ]);

    const intelligence = await getProjectPerformanceIntelligence(user.id, projectId);

    return apiSuccess({
      sync: syncResult,
      intelligence,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
