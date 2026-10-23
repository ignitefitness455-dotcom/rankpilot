import { requireAuthUser } from "@/lib/auth";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { getUserUsageSummary } from "@/lib/settings/service";

export async function GET() {
  try {
    const user = await requireAuthUser();
    const usage = await getUserUsageSummary(user.id);
    return apiSuccess(usage);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
