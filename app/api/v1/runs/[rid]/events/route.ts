import { apiErrorResponse } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import {
  getRunDetailWithSteps,
  subscribeRunEvents,
} from "@/lib/ai/orchestrator";

export async function GET(
  req: Request,
  context: { params: Promise<{ rid: string }> },
): Promise<Response> {
  try {
    const user = await requireAuthUser();
    const { rid } = await context.params;
    const initial = await getRunDetailWithSteps(user.id, rid);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (payload: unknown) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          } catch {
            // Stream closed
          }
        };

        send({
          runId: initial.run.id,
          status: initial.run.status,
          steps: initial.steps,
          tokensIn: initial.run.tokensIn,
          tokensOut: initial.run.tokensOut,
          tokensCached: initial.run.tokensCached,
          costUsd: initial.run.costUsd,
          done:
            initial.run.status === "succeeded" ||
            initial.run.status === "failed" ||
            initial.run.status === "cancelled" ||
            initial.run.status === "budget_exceeded",
        });

        const unsubscribe = subscribeRunEvents(rid, (ev) => {
          send(ev);
          if (ev.done) {
            unsubscribe();
            try {
              controller.close();
            } catch {
              // Ignore
            }
          }
        });

        req.signal.addEventListener("abort", () => {
          unsubscribe();
          try {
            controller.close();
          } catch {
            // Ignore
          }
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
