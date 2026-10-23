import { NextResponse } from "next/server";
import { exportProjectTasks } from "@/lib/actions/service";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { postExportTasksSchema } from "@/lib/schemas/api/ops";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { id: projectId } = await context.params;
    const body = postExportTasksSchema.parse(await req.json());

    const bundle = await exportProjectTasks({
      userId: user.id,
      projectId,
      format: body.format,
      onlyApproved: body.onlyApproved,
    });

    return apiSuccess(bundle);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
