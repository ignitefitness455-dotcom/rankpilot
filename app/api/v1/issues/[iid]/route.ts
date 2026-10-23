import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { getIssueDetails, updateIssueStatus } from "@/lib/crawler/runner";
import { updateIssueStatusRequestSchema } from "@/lib/schemas/api/audit";
import { NotFoundError } from "@/lib/security/authz";
import { enforceRateLimit } from "@/lib/security/rate-limit";

interface RouteParams {
  params: Promise<{ iid: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    const { iid } = await params;
    const detail = await getIssueDetails(user.id, iid);
    if (!detail) {
      throw new NotFoundError("Issue not found");
    }
    return apiSuccess(detail);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    await enforceRateLimit("api_write", user.id);
    const { iid } = await params;
    const body = await req.json();
    const parsed = updateIssueStatusRequestSchema.parse(body);

    const updated = await updateIssueStatus({
      userId: user.id,
      issueId: iid,
      status: parsed.status,
      ignoredReason: parsed.ignoredReason,
    });

    return apiSuccess({ issue: updated });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
