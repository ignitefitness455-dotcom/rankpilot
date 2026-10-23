import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { updateContentItemAndSaveVersion } from "@/lib/content/studio";
import { patchContentItemSchema } from "@/lib/schemas/api/research";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ cid: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { cid } = await context.params;

    const body = patchContentItemSchema.parse(await req.json());
    const item = await updateContentItemAndSaveVersion({
      userId: user.id,
      contentItemId: cid,
      title: body.title,
      status: body.status,
      bodyMd: body.bodyMd,
    });

    return apiSuccess({ item });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
