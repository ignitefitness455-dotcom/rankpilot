import type { NextRequest } from "next/server";
import { requireAuthUser } from "@/lib/auth";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { updateBudgetSettingsSchema } from "@/lib/schemas/api/settings";
import {
  getOrCreateUserSettings,
  updateUserBudgetSettings,
} from "@/lib/settings/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function GET() {
  try {
    const user = await requireAuthUser();
    const settings = await getOrCreateUserSettings(user.id);
    return apiSuccess(settings);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuthUser();
    await enforceRateLimit("api_write", user.id);
    const parsed = updateBudgetSettingsSchema.parse(await req.json());
    const updated = await updateUserBudgetSettings(user.id, parsed);
    return apiSuccess(updated);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
