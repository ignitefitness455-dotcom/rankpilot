import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { getCrawlDetails } from "@/lib/crawler/runner";
import { NotFoundError } from "@/lib/security/authz";

interface RouteParams {
  params: Promise<{ cid: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    const { cid } = await params;
    const crawl = await getCrawlDetails(user.id, cid);
    if (!crawl) {
      throw new NotFoundError("Crawl not found");
    }
    return apiSuccess({ crawl });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
