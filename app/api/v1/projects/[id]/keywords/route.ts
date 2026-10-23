import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { listProjectKeywords, runKeywordResearch } from "@/lib/keywords/service";
import { postKeywordResearchSchema } from "@/lib/schemas/api/research";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { id: projectId } = await context.params;

    const overview = await listProjectKeywords(user.id, projectId);
    return apiSuccess(overview);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { id: projectId } = await context.params;

    const body = postKeywordResearchSchema.parse(await req.json().catch(() => ({})));
    const overview = await runKeywordResearch({
      userId: user.id,
      projectId,
      seedKeywords: body.seedKeywords,
      autoTrackTop: body.autoTrackTop,
    });

    return apiSuccess(overview);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
