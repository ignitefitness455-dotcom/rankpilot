import { requireAuthUser } from "@/lib/auth";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { listUserIntegrationsMasked } from "@/lib/settings/service";

export async function GET() {
  try {
    const user = await requireAuthUser();
    const list = await listUserIntegrationsMasked(user.id);
    return apiSuccess(list);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
