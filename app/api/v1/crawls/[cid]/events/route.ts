import type { NextRequest } from "next/server";
import { apiErrorResponse } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import {
  getCrawlDetails,
  subscribeCrawlProgress,
  type CrawlProgressEvent,
} from "@/lib/crawler/runner";
import { NotFoundError } from "@/lib/security/authz";

interface RouteParams {
  params: Promise<{ cid: string }>;
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    const { cid } = await params;
    const initial = await getCrawlDetails(user.id, cid);
    if (!initial) {
      throw new NotFoundError("Crawl not found");
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;

        const sendEvent = (payload: CrawlProgressEvent) => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
            );
          } catch {
            closed = true;
          }
        };

        // Send initial state immediately
        sendEvent({
          crawlId: initial.id,
          status: initial.status,
          pagesFound: initial.pagesFound,
          pagesCrawled: initial.pagesCrawled,
          progress: initial.progress,
          healthScore: initial.healthScore,
          error: initial.error,
        });

        if (
          initial.status === "completed" ||
          initial.status === "failed" ||
          initial.status === "cancelled"
        ) {
          closed = true;
          controller.close();
          return;
        }

        const unsubscribe = subscribeCrawlProgress(cid, (ev) => {
          sendEvent(ev);
          if (
            ev.status === "completed" ||
            ev.status === "failed" ||
            ev.status === "cancelled"
          ) {
            cleanup();
          }
        });

        // Also poll DB every 2s in case crawl is running in a separate worker process
        const pollTimer = setInterval(async () => {
          if (closed) return;
          try {
            const latest = await getCrawlDetails(user.id, cid);
            if (!latest) return;
            sendEvent({
              crawlId: latest.id,
              status: latest.status,
              pagesFound: latest.pagesFound,
              pagesCrawled: latest.pagesCrawled,
              progress: latest.progress,
              healthScore: latest.healthScore,
              error: latest.error,
            });
            if (
              latest.status === "completed" ||
              latest.status === "failed" ||
              latest.status === "cancelled"
            ) {
              cleanup();
            }
          } catch {
            // ignore transient DB poll errors
          }
        }, 2_000);

        const cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(pollTimer);
          unsubscribe();
          try {
            controller.close();
          } catch {
            // already closed
          }
        };

        req.signal.addEventListener("abort", cleanup);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
