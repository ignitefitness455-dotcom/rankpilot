import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import {
  addTrackedPrompt,
  getProjectGeoOverview,
  removeTrackedPrompt,
} from "@/lib/geo/service";
import { postTrackedPromptSchema } from "@/lib/schemas/api/ops";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { id: projectId } = await context.params;
    const overview = await getProjectGeoOverview(user.id, projectId);
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
    const body = postTrackedPromptSchema.parse(await req.json());

    const prompt = await addTrackedPrompt({
      userId: user.id,
      projectId,
      prompt: body.prompt,
      locale: body.locale,
      engines: body.engines,
    });

    return apiSuccess({ prompt }, 201);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { id: projectId } = await context.params;
    const url = new URL(req.url);
    const promptId = url.searchParams.get("promptId");
    if (!promptId) {
      return NextResponse.json(
        { ok: false, error: { code: "BAD_REQUEST", message: "Missing promptId" } },
        { status: 400 },
      );
    }

    await removeTrackedPrompt({
      userId: user.id,
      projectId,
      promptId,
    });

    return apiSuccess({ removed: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
