import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import {
  listProjectRunsAndMessages,
  runAgentChat,
} from "@/lib/ai/orchestrator";
import { postAgentChatSchema } from "@/lib/schemas/api/agent";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { id: projectId } = await context.params;
    const data = await listProjectRunsAndMessages(user.id, projectId);
    return apiSuccess(data);
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
    await enforceRateLimit("agent_chat", user.id);

    const { id: projectId } = await context.params;
    const body = await req.json();
    const parsed = postAgentChatSchema.parse(body);

    const result = await runAgentChat({
      userId: user.id,
      projectId,
      message: parsed.message,
      requestedAgent: parsed.agent,
      locale: parsed.locale,
    });

    return apiSuccess(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
