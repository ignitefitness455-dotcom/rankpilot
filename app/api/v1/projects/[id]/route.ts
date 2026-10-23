import type { NextRequest } from "next/server";
import { requireAuthUser } from "@/lib/auth";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import {
  getProjectDetail,
  softDeleteProject,
  updateProjectById,
} from "@/lib/projects/service";
import { updateProjectSchema } from "@/lib/schemas/api/projects";
import { enforceRateLimit } from "@/lib/security/rate-limit";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    const { id } = await params;
    const detail = await getProjectDetail(user.id, id);
    return apiSuccess(detail);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    await enforceRateLimit("api_write", user.id);
    const { id } = await params;
    const body = await req.json();
    const parsed = updateProjectSchema.parse(body);
    const updated = await updateProjectById(user.id, id, parsed);
    return apiSuccess(updated);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    await enforceRateLimit("api_write", user.id);
    const { id } = await params;
    const result = await softDeleteProject(user.id, id);
    return apiSuccess(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
