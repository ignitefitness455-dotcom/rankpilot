import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { analyzeCompetitorAndSerpGap } from "@/lib/competitors/service";
import { postCompetitorAnalyzeSchema } from "@/lib/schemas/api/research";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { id: projectId } = await context.params;

    const body = postCompetitorAnalyzeSchema.parse(await req.json());
    const report = await analyzeCompetitorAndSerpGap({
      userId: user.id,
      projectId,
      query: body.query,
      competitorUrls: body.competitorUrls,
    });

    return apiSuccess({ report });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
