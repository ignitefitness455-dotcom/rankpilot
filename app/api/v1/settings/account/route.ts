import { requireAuthUser } from "@/lib/auth";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { deleteUserAccount } from "@/lib/settings/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function DELETE() {
  try {
    const user = await requireAuthUser();
    await enforceRateLimit("api_write", user.id);
    await deleteUserAccount(user.id);
    return apiSuccess({ deleted: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
