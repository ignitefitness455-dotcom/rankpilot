import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { getPageDetails } from "@/lib/crawler/runner";
import { NotFoundError } from "@/lib/security/authz";

interface RouteParams {
  params: Promise<{ pid: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    const { pid } = await params;
    const detail = await getPageDetails(user.id, pid);
    if (!detail) {
      throw new NotFoundError("Page not found");
    }
    return apiSuccess(detail);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
