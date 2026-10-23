import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import {
  addProjectCompetitor,
  listProjectCompetitors,
  removeProjectCompetitor,
} from "@/lib/competitors/service";
import { postCompetitorCreateSchema } from "@/lib/schemas/api/research";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { id: projectId } = await context.params;

    const competitors = await listProjectCompetitors(user.id, projectId);
    return apiSuccess({ competitors });
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

    const body = postCompetitorCreateSchema.parse(await req.json());
    const competitor = await addProjectCompetitor({
      userId: user.id,
      projectId,
      hostOrUrl: body.hostOrUrl,
      name: body.name,
      notes: body.notes,
    });

    return apiSuccess({ competitor }, 201);
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
    const competitorId = url.searchParams.get("competitorId");
    if (!competitorId) {
      return NextResponse.json(
        { ok: false, error: { code: "BAD_REQUEST", message: "Missing competitorId" } },
        { status: 400 },
      );
    }

    await removeProjectCompetitor({
      userId: user.id,
      projectId,
      competitorId,
    });

    return apiSuccess({ removed: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
