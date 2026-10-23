import { NextResponse } from "next/server";
import {
  createProjectTask,
  listProjectActionCenter,
  syncAuditIssuesToTasks,
} from "@/lib/actions/service";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { postCreateOrSyncTaskSchema } from "@/lib/schemas/api/ops";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { id: projectId } = await context.params;

    const overview = await listProjectActionCenter(user.id, projectId);
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
    const body = postCreateOrSyncTaskSchema.parse(await req.json());

    if (body.action === "sync_from_audit") {
      const syncedCount = await syncAuditIssuesToTasks(user.id, projectId);
      const overview = await listProjectActionCenter(user.id, projectId);
      return apiSuccess({ syncedCount, overview });
    }

    const task = await createProjectTask({
      userId: user.id,
      projectId,
      title: body.title,
      description: body.description,
      impact: body.impact,
      effort: body.effort,
      confidence: body.confidence,
      ruleId: body.ruleId,
      fixSnippet: body.fixSnippet,
    });

    return apiSuccess({ task }, 201);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
