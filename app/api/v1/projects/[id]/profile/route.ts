import type { NextRequest } from "next/server";
import { requireAuthUser } from "@/lib/auth";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { getProjectDetail, updateProjectProfile } from "@/lib/projects/service";
import { profileFieldsSchema } from "@/lib/schemas/api/projects";
import { enforceRateLimit } from "@/lib/security/rate-limit";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    const { id } = await params;
    const detail = await getProjectDetail(user.id, id);
    return apiSuccess(detail.profile);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    await enforceRateLimit("api_write", user.id);
    const { id } = await params;
    const body = await req.json();
    const parsed = profileFieldsSchema.parse(body);
    const updated = await updateProjectProfile(user.id, id, parsed);
    return apiSuccess(updated);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
