import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { verifyProjectOwnership } from "@/lib/projects/verify";
import { verifyOwnershipRequestSchema } from "@/lib/schemas/api/audit";
import { enforceRateLimit } from "@/lib/security/rate-limit";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    await enforceRateLimit("api_write", user.id);
    const { id } = await params;
    const body = await req.json();
    const parsed = verifyOwnershipRequestSchema.parse(body);

    const result = await verifyProjectOwnership({
      userId: user.id,
      projectId: id,
      method: parsed.method,
    });

    return apiSuccess(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
