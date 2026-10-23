import { requireAuthUser } from "@/lib/auth";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { exportUserAccountData } from "@/lib/settings/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST() {
  try {
    const user = await requireAuthUser();
    await enforceRateLimit("export", user.id);
    const exported = await exportUserAccountData(user.id);
    return apiSuccess(exported);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
