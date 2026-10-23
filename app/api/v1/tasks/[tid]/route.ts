import { NextResponse } from "next/server";
import { updateTaskWithApprovalGate } from "@/lib/actions/service";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { patchTaskDecisionSchema } from "@/lib/schemas/api/ops";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ tid: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { tid } = await context.params;
    const body = patchTaskDecisionSchema.parse(await req.json());

    const task = await updateTaskWithApprovalGate({
      userId: user.id,
      taskId: tid,
      status: body.status,
      decision: body.decision,
      editedTitle: body.editedTitle,
      editedDescription: body.editedDescription,
      editedSnippet: body.editedSnippet,
      dismissReason: body.dismissReason,
    });

    return apiSuccess({ task });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
