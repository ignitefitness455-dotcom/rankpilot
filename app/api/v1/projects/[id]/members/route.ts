import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthUser } from "@/lib/auth";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { withUserDb } from "@/lib/db/rls";
import {
  addProjectMemberByEmail,
  listProjectMembers,
  removeProjectMember,
} from "@/lib/projects/service";
import { addMemberSchema } from "@/lib/schemas/api/projects";
import { enforceRateLimit } from "@/lib/security/rate-limit";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    const { id } = await params;
    const members = await withUserDb(user.id, (tx) => listProjectMembers(tx, user.id, id));
    return apiSuccess(members);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    await enforceRateLimit("api_write", user.id);
    const { id } = await params;
    const body = await req.json();
    const parsed = addMemberSchema.parse(body);
    const added = await addProjectMemberByEmail(user.id, id, parsed.email, parsed.role);
    return apiSuccess(added, 201);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    await enforceRateLimit("api_write", user.id);
    const { id } = await params;
    const { userId } = z.object({ userId: z.string().min(1) }).parse(await req.json());
    const res = await removeProjectMember(user.id, id, userId);
    return apiSuccess(res);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
