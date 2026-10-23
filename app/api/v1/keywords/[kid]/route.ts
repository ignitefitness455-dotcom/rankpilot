import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { updateKeywordTracking } from "@/lib/keywords/service";
import { patchKeywordSchema } from "@/lib/schemas/api/research";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ kid: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { kid } = await context.params;
    const body = patchKeywordSchema.parse(await req.json());

    const updated = await updateKeywordTracking({
      userId: user.id,
      keywordId: kid,
      tracked: body.tracked,
    });

    return apiSuccess(updated);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
