import type { NextRequest } from "next/server";
import { requireAuthUser } from "@/lib/auth";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { createProjectForUser, getUserProjects } from "@/lib/projects/service";
import { createProjectSchema } from "@/lib/schemas/api/projects";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function GET() {
  try {
    const user = await requireAuthUser();
    const items = await getUserProjects(user.id);
    return apiSuccess(items);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuthUser();
    await enforceRateLimit("api_write", user.id);
    const body = await req.json();
    const parsed = createProjectSchema.parse(body);
    const created = await createProjectForUser(user.id, parsed);
    return apiSuccess(created, 201);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
