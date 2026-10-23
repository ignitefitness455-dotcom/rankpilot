import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/auth";
import {
  GOOGLE_OAUTH_READONLY_SCOPES,
  saveGoogleOAuthIntegration,
  verifySignedOAuthState,
} from "@/lib/google/oauth";
import { getEnv } from "@/lib/security/env";

export async function GET(req: Request): Promise<NextResponse> {
  const env = getEnv();
  const appBase = env.APP_URL.replace(/\/$/, "");

  try {
    const user = await requireAuthUser();
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");

    if (!code || !state) {
      return NextResponse.redirect(`${appBase}/en/settings?google=missing_params`);
    }

    const verified = verifySignedOAuthState(state);
    if (!verified || verified.userId !== user.id) {
      return NextResponse.redirect(`${appBase}/en/settings?google=invalid_state`);
    }

    const redirectUri = `${appBase}/api/v1/integrations/google/callback`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.AUTH_GOOGLE_ID,
        client_secret: env.AUTH_GOOGLE_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      return NextResponse.redirect(
        `${appBase}/en/p/${verified.projectId}/dashboard?google=token_error`,
      );
    }

    const tokenJson = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };

    await saveGoogleOAuthIntegration({
      userId: user.id,
      projectId: verified.projectId,
      tokenPayload: {
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token,
        expiresAtMs: Date.now() + (tokenJson.expires_in ?? 3600) * 1000,
      },
      scopes: tokenJson.scope
        ? tokenJson.scope.split(" ").filter(Boolean)
        : [...GOOGLE_OAUTH_READONLY_SCOPES],
    });

    return NextResponse.redirect(
      `${appBase}/en/p/${verified.projectId}/dashboard?google=connected`,
    );
  } catch {
    return NextResponse.redirect(`${appBase}/en/settings?google=callback_error`);
  }
}
