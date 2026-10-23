import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { runPromptVisibilityChecks } from "@/lib/geo/service";
import { postRunVisibilityChecksSchema } from "@/lib/schemas/api/ops";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { id: projectId } = await context.params;
    const body = postRunVisibilityChecksSchema.parse(
      await req.json().catch(() => ({})),
    );

    const overview = await runPromptVisibilityChecks({
      userId: user.id,
      projectId,
      promptId: body.promptId,
    });

    return apiSuccess(overview);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
