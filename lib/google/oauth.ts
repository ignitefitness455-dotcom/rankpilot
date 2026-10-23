import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { integrations } from "@/lib/db/schema";
import { withUserDb } from "@/lib/db/rls";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { getEnv } from "@/lib/security/env";

/**
 * Least-privilege read-only Google OAuth scopes (§4.4).
 * Never request write/edit scopes for Search Console or Google Analytics.
 */
export const GOOGLE_OAUTH_READONLY_SCOPES = [
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
] as const;

export interface StoredGoogleTokenPayload {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs?: number;
}

export interface GoogleConnectionStatus {
  connected: boolean;
  mode: "oauth" | "demo_ready";
  scopes: string[];
  gscProperty: string | null;
  ga4PropertyId: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  oauthConfiguredInEnv: boolean;
}

function buildOAuthAad(userId: string, projectId: string | null): string {
  return `${userId}:google_oauth:${projectId ?? "global"}`;
}

export function createSignedOAuthState(payload: {
  userId: string;
  projectId: string;
  issuedAt: number;
}): string {
  const env = getEnv();
  const dataB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", env.AUTH_SECRET).update(dataB64).digest("base64url");
  return `${dataB64}.${sig}`;
}

export function verifySignedOAuthState(state: string): {
  userId: string;
  projectId: string;
  issuedAt: number;
} | null {
  const env = getEnv();
  const [dataB64, sig] = state.split(".");
  if (!dataB64 || !sig) return null;

  const expectedSig = createHmac("sha256", env.AUTH_SECRET).update(dataB64).digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(dataB64, "base64url").toString("utf8")) as {
      userId: string;
      projectId: string;
      issuedAt: number;
    };
    if (!parsed.userId || !parsed.projectId) return null;
    if (Date.now() - parsed.issuedAt > 15 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildGoogleOAuthConsentUrl(params: {
  userId: string;
  projectId: string;
  redirectUri?: string;
}): { url: string | null; oauthConfigured: boolean } {
  const env = getEnv();
  if (!env.AUTH_GOOGLE_ID || !env.AUTH_GOOGLE_SECRET) {
    return { url: null, oauthConfigured: false };
  }

  const redirectUri =
    params.redirectUri ?? `${env.APP_URL.replace(/\/$/, "")}/api/v1/integrations/google/callback`;
  const state = createSignedOAuthState({
    userId: params.userId,
    projectId: params.projectId,
    issuedAt: Date.now(),
  });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.AUTH_GOOGLE_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("scope", GOOGLE_OAUTH_READONLY_SCOPES.join(" "));
  url.searchParams.set("state", state);

  return { url: url.toString(), oauthConfigured: true };
}

export async function saveGoogleOAuthIntegration(params: {
  userId: string;
  projectId: string;
  tokenPayload: StoredGoogleTokenPayload;
  scopes: string[];
  gscProperty?: string | null;
  ga4PropertyId?: string | null;
}): Promise<void> {
  const aad = buildOAuthAad(params.userId, params.projectId);
  const enc = encryptSecret(JSON.stringify(params.tokenPayload), aad);

  await withUserDb(params.userId, async (tx) => {
    const [existing] = await tx
      .select({ id: integrations.id, meta: integrations.meta })
      .from(integrations)
      .where(
        and(
          eq(integrations.ownerId, params.userId),
          eq(integrations.projectId, params.projectId),
          eq(integrations.kind, "google_oauth"),
        ),
      )
      .limit(1);

    const nextMeta: Record<string, unknown> = {
      ...(existing?.meta ?? {}),
      ...(params.gscProperty !== undefined ? { gscProperty: params.gscProperty } : {}),
      ...(params.ga4PropertyId !== undefined ? { ga4PropertyId: params.ga4PropertyId } : {}),
    };

    if (existing) {
      await tx
        .update(integrations)
        .set({
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          tag: enc.tag,
          keyVersion: enc.keyVersion,
          last4: enc.last4,
          scopes: params.scopes,
          meta: nextMeta,
          lastOkAt: new Date(),
          lastError: null,
        })
        .where(eq(integrations.id, existing.id));
    } else {
      await tx.insert(integrations).values({
        ownerId: params.userId,
        projectId: params.projectId,
        kind: "google_oauth",
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        tag: enc.tag,
        keyVersion: enc.keyVersion,
        last4: enc.last4,
        scopes: params.scopes,
        meta: nextMeta,
        lastOkAt: new Date(),
      });
    }
  });
}

export async function getGoogleConnectionStatus(
  userId: string,
  projectId: string,
): Promise<GoogleConnectionStatus> {
  const env = getEnv();
  const oauthConfiguredInEnv = Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);

  return withUserDb(userId, async (tx) => {
    const [row] = await tx
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.ownerId, userId),
          eq(integrations.projectId, projectId),
          eq(integrations.kind, "google_oauth"),
        ),
      )
      .limit(1);

    if (!row) {
      return {
        connected: false,
        mode: "demo_ready",
        scopes: [...GOOGLE_OAUTH_READONLY_SCOPES],
        gscProperty: null,
        ga4PropertyId: null,
        lastOkAt: null,
        lastError: null,
        oauthConfiguredInEnv,
      };
    }

    const meta = (row.meta ?? {}) as Record<string, unknown>;
    return {
      connected: true,
      mode: "oauth",
      scopes: row.scopes ?? [...GOOGLE_OAUTH_READONLY_SCOPES],
      gscProperty: typeof meta.gscProperty === "string" ? meta.gscProperty : null,
      ga4PropertyId: typeof meta.ga4PropertyId === "string" ? meta.ga4PropertyId : null,
      lastOkAt: row.lastOkAt ? row.lastOkAt.toISOString() : null,
      lastError: row.lastError,
      oauthConfiguredInEnv,
    };
  });
}

export async function disconnectGoogleIntegration(
  userId: string,
  projectId: string,
): Promise<void> {
  await withUserDb(userId, async (tx) => {
    await tx
      .delete(integrations)
      .where(
        and(
          eq(integrations.ownerId, userId),
          eq(integrations.projectId, projectId),
          eq(integrations.kind, "google_oauth"),
        ),
      );
    await tx
      .delete(integrations)
      .where(
        and(
          eq(integrations.ownerId, userId),
          isNull(integrations.projectId),
          eq(integrations.kind, "google_oauth"),
        ),
      );
  });
}

/**
 * Server-only helper to resolve a valid Google OAuth access token for Search Console / GA4 calls.
 * Automatically refreshes the token if expired and `refreshToken` is present.
 */
export async function resolveGoogleAccessToken(
  userId: string,
  projectId: string,
): Promise<{
  accessToken: string;
  gscProperty: string | null;
  ga4PropertyId: string | null;
} | null> {
  const row = await withUserDb(userId, async (tx) => {
    const [found] = await tx
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.ownerId, userId),
          eq(integrations.projectId, projectId),
          eq(integrations.kind, "google_oauth"),
        ),
      )
      .limit(1);
    return found ?? null;
  });

  if (!row) return null;

  const aad = buildOAuthAad(userId, projectId);
  let payload: StoredGoogleTokenPayload;
  try {
    payload = JSON.parse(decryptSecret(row, aad)) as StoredGoogleTokenPayload;
  } catch {
    return null;
  }

  const meta = (row.meta ?? {}) as Record<string, unknown>;
  const gscProperty = typeof meta.gscProperty === "string" ? meta.gscProperty : null;
  const ga4PropertyId = typeof meta.ga4PropertyId === "string" ? meta.ga4PropertyId : null;

  const env = getEnv();
  const isExpired =
    payload.expiresAtMs !== undefined && payload.expiresAtMs <= Date.now() + 60_000;

  if (isExpired && payload.refreshToken && env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.AUTH_GOOGLE_ID,
          client_secret: env.AUTH_GOOGLE_SECRET,
          refresh_token: payload.refreshToken,
          grant_type: "refresh_token",
        }),
      });
      if (res.ok) {
        const refreshed = (await res.json()) as {
          access_token: string;
          expires_in?: number;
        };
        payload = {
          accessToken: refreshed.access_token,
          refreshToken: payload.refreshToken,
          expiresAtMs: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
        };
        await saveGoogleOAuthIntegration({
          userId,
          projectId,
          tokenPayload: payload,
          scopes: row.scopes,
          gscProperty,
          ga4PropertyId,
        });
      }
    } catch {
      // Fall back to existing token if refresh fails
    }
  }

  return {
    accessToken: payload.accessToken,
    gscProperty,
    ga4PropertyId,
  };
}
