import type { NextRequest } from "next/server";
import { requireAuthUser } from "@/lib/auth";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { byokKindEnum, putApiKeySchema } from "@/lib/schemas/api/settings";
import {
  deleteUserApiKey,
  listUserIntegrationsMasked,
  upsertUserApiKey,
} from "@/lib/settings/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";

interface RouteParams {
  params: Promise<{ kind: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    const { kind } = await params;
    const parsedKind = byokKindEnum.parse(kind);
    const list = await listUserIntegrationsMasked(user.id);
    const item = list.find((k) => k.kind === parsedKind);
    return apiSuccess(item ?? null);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    await enforceRateLimit("api_write", user.id);
    const { kind } = await params;
    const parsedKind = byokKindEnum.parse(kind);
    const body = putApiKeySchema.parse(await req.json());
    const saved = await upsertUserApiKey(user.id, parsedKind, body.secret, body.meta);
    return apiSuccess(saved);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    await enforceRateLimit("api_write", user.id);
    const { kind } = await params;
    const parsedKind = byokKindEnum.parse(kind);
    await deleteUserApiKey(user.id, parsedKind);
    return apiSuccess({ deleted: true, kind: parsedKind });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
