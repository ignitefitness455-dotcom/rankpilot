import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { generateDraftForContentItem } from "@/lib/content/studio";

export async function POST(
  _req: Request,
  context: { params: Promise<{ cid: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { cid } = await context.params;

    const item = await generateDraftForContentItem({
      userId: user.id,
      contentItemId: cid,
    });

    return apiSuccess({ item });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
