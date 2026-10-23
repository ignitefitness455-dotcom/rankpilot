import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { disconnectGoogleIntegration } from "@/lib/google/oauth";
import { connectGoogleQuerySchema } from "@/lib/schemas/api/performance";

export async function DELETE(req: Request): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { searchParams } = new URL(req.url);
    const parsed = connectGoogleQuerySchema.parse({
      projectId: searchParams.get("projectId"),
    });

    await disconnectGoogleIntegration(user.id, parsed.projectId);
    return apiSuccess({ disconnected: true });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
