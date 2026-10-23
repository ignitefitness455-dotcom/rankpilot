import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import {
  buildGoogleOAuthConsentUrl,
  getGoogleConnectionStatus,
} from "@/lib/google/oauth";
import { connectGoogleQuerySchema } from "@/lib/schemas/api/performance";

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { searchParams } = new URL(req.url);
    const parsed = connectGoogleQuerySchema.parse({
      projectId: searchParams.get("projectId"),
    });

    const status = await getGoogleConnectionStatus(user.id, parsed.projectId);
    const consent = buildGoogleOAuthConsentUrl({
      userId: user.id,
      projectId: parsed.projectId,
    });

    return apiSuccess({
      status,
      consentUrl: consent.url,
      oauthConfigured: consent.oauthConfigured,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
