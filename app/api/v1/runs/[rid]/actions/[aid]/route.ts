import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { handleAgentActionDecision } from "@/lib/ai/orchestrator";
import { postAgentActionDecisionSchema } from "@/lib/schemas/api/agent";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(
  req: Request,
  context: { params: Promise<{ rid: string; aid: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    await enforceRateLimit("api_write", user.id);

    const { rid, aid } = await context.params;
    const body = await req.json();
    const parsed = postAgentActionDecisionSchema.parse(body);

    const outcome = await handleAgentActionDecision({
      userId: user.id,
      runId: rid,
      actionId: aid,
      decision: parsed.decision,
      editedTitle: parsed.editedTitle,
      editedSnippet: parsed.editedSnippet,
      dismissReason: parsed.dismissReason,
    });

    return apiSuccess(outcome);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
