import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import {
  createContentBriefAndOptionalDraft,
  listProjectContentItems,
} from "@/lib/content/studio";
import { postContentCreateSchema } from "@/lib/schemas/api/research";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { id: projectId } = await context.params;

    const items = await listProjectContentItems(user.id, projectId);
    return apiSuccess({ items });
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

    const body = postContentCreateSchema.parse(await req.json());
    const item = await createContentBriefAndOptionalDraft({
      userId: user.id,
      projectId,
      targetKeyword: body.targetKeyword,
      title: body.title,
      generateInitialDraft: body.generateInitialDraft,
    });

    return apiSuccess({ item }, 201);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
