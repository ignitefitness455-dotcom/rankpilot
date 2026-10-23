import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  integrations,
  projects,
  usageMetrics,
  userSettings,
  type IntegrationKind,
} from "@/lib/db/schema";
import { withUserDb } from "@/lib/db/rls";
import { getAdminDb } from "@/lib/db/client";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { getEnv } from "@/lib/security/env";
import type { ByokKind, updateBudgetSettingsSchema } from "@/lib/schemas/api/settings";
import type { z } from "zod";

export interface MaskedIntegrationSummary {
  kind: IntegrationKind;
  configured: boolean;
  source: "byok" | "server_env" | "none";
  last4: string | null;
  keyVersion: number | null;
  updatedAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
}

const BYOK_KINDS: ByokKind[] = [
  "gemini_key",
  "serpapi",
  "serper",
  "dataforseo",
  "openai",
  "perplexity",
  "smtp",
];

function hasServerEnvKey(kind: ByokKind): boolean {
  const env = getEnv();
  switch (kind) {
    case "gemini_key":
      return Boolean(env.GEMINI_API_KEY);
    case "serpapi":
      return Boolean(env.SERPAPI_KEY);
    case "serper":
      return Boolean(env.SERPER_API_KEY);
    case "dataforseo":
      return Boolean(env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD);
    case "openai":
      return Boolean(env.OPENAI_API_KEY);
    case "perplexity":
      return Boolean(env.PERPLEXITY_API_KEY);
    case "smtp":
      return Boolean(env.SMTP_URL);
  }
}

function buildKeyAad(ownerId: string, kind: IntegrationKind, projectId?: string | null): string {
  return `${ownerId}:${kind}:${projectId ?? "global"}`;
}

export async function listUserIntegrationsMasked(
  userId: string,
): Promise<MaskedIntegrationSummary[]> {
  return withUserDb(userId, async (tx) => {
    const rows = await tx
      .select({
        kind: integrations.kind,
        last4: integrations.last4,
        keyVersion: integrations.keyVersion,
        updatedAt: integrations.updatedAt,
        lastOkAt: integrations.lastOkAt,
        lastError: integrations.lastError,
      })
      .from(integrations)
      .where(and(eq(integrations.ownerId, userId), isNull(integrations.projectId)));

    const byKind = new Map(rows.map((r) => [r.kind, r]));

    return BYOK_KINDS.map((kind) => {
      const row = byKind.get(kind);
      if (row) {
        return {
          kind,
          configured: true,
          source: "byok",
          last4: row.last4 ?? "••••",
          keyVersion: row.keyVersion,
          updatedAt: row.updatedAt.toISOString(),
          lastOkAt: row.lastOkAt ? row.lastOkAt.toISOString() : null,
          lastError: row.lastError,
        };
      }
      const serverConfigured = hasServerEnvKey(kind);
      return {
        kind,
        configured: serverConfigured,
        source: serverConfigured ? "server_env" : "none",
        last4: null,
        keyVersion: null,
        updatedAt: null,
        lastOkAt: null,
        lastError: null,
      };
    });
  });
}

export async function upsertUserApiKey(
  userId: string,
  kind: ByokKind,
  secretPlaintext: string,
  meta: Record<string, unknown> = {},
): Promise<MaskedIntegrationSummary> {
  const aad = buildKeyAad(userId, kind, null);
  const enc = encryptSecret(secretPlaintext, aad);

  return withUserDb(userId, async (tx) => {
    const [existing] = await tx
      .select({ id: integrations.id })
      .from(integrations)
      .where(
        and(
          eq(integrations.ownerId, userId),
          eq(integrations.kind, kind),
          isNull(integrations.projectId),
        ),
      )
      .limit(1);

    let saved;
    if (existing) {
      const [u] = await tx
        .update(integrations)
        .set({
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          tag: enc.tag,
          keyVersion: enc.keyVersion,
          last4: enc.last4,
          meta,
          lastError: null,
        })
        .where(eq(integrations.id, existing.id))
        .returning();
      saved = u!;
    } else {
      const [ins] = await tx
        .insert(integrations)
        .values({
          ownerId: userId,
          projectId: null,
          kind,
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          tag: enc.tag,
          keyVersion: enc.keyVersion,
          last4: enc.last4,
          meta,
        })
        .returning();
      saved = ins!;
    }

    return {
      kind: saved.kind,
      configured: true,
      source: "byok",
      last4: saved.last4,
      keyVersion: saved.keyVersion,
      updatedAt: saved.updatedAt.toISOString(),
      lastOkAt: saved.lastOkAt ? saved.lastOkAt.toISOString() : null,
      lastError: saved.lastError,
    };
  });
}

export async function deleteUserApiKey(userId: string, kind: ByokKind): Promise<void> {
  await withUserDb(userId, async (tx) => {
    await tx
      .delete(integrations)
      .where(
        and(
          eq(integrations.ownerId, userId),
          eq(integrations.kind, kind),
          isNull(integrations.projectId),
        ),
      );
  });
}

/**
 * Server-only helper (Phase 3+) to decrypt a user's BYOK key, falling back to `.env`.
 * Never expose the return value in any API response.
 */
export async function resolveDecryptedSecret(
  userId: string,
  kind: ByokKind,
): Promise<{ secret: string; source: "byok" | "server_env" } | null> {
  const row = await withUserDb(userId, async (tx) => {
    const [found] = await tx
      .select()
      .from(integrations)
      .where(
        and(
          eq(integrations.ownerId, userId),
          eq(integrations.kind, kind),
          isNull(integrations.projectId),
        ),
      )
      .limit(1);
    return found ?? null;
  });

  if (row) {
    const aad = buildKeyAad(userId, kind, null);
    const plain = decryptSecret(row, aad);
    return { secret: plain, source: "byok" };
  }

  const env = getEnv();
  const envMap: Record<ByokKind, string> = {
    gemini_key: env.GEMINI_API_KEY,
    serpapi: env.SERPAPI_KEY,
    serper: env.SERPER_API_KEY,
    dataforseo:
      env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD
        ? `${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`
        : "",
    openai: env.OPENAI_API_KEY,
    perplexity: env.PERPLEXITY_API_KEY,
    smtp: env.SMTP_URL,
  };
  const fallback = envMap[kind];
  return fallback ? { secret: fallback, source: "server_env" } : null;
}

export async function getOrCreateUserSettings(userId: string) {
  const env = getEnv();
  return withUserDb(userId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);
    if (existing) {
      return {
        userId: existing.userId,
        locale: existing.locale,
        theme: existing.theme,
        budgetRunUsd: Number(existing.budgetRunUsd),
        budgetProjectDayUsd: Number(existing.budgetProjectDayUsd),
        budgetUserMonthUsd: Number(existing.budgetUserMonthUsd),
        useFastModel: existing.useFastModel,
      };
    }
    const [inserted] = await tx
      .insert(userSettings)
      .values({
        userId,
        locale: "en",
        theme: "system",
        budgetRunUsd: String(env.AI_BUDGET_RUN_USD),
        budgetProjectDayUsd: String(env.AI_BUDGET_PROJECT_DAY_USD),
        budgetUserMonthUsd: String(env.AI_BUDGET_USER_MONTH_USD),
        useFastModel: true,
      })
      .returning();
    return {
      userId: inserted!.userId,
      locale: inserted!.locale,
      theme: inserted!.theme,
      budgetRunUsd: Number(inserted!.budgetRunUsd),
      budgetProjectDayUsd: Number(inserted!.budgetProjectDayUsd),
      budgetUserMonthUsd: Number(inserted!.budgetUserMonthUsd),
      useFastModel: inserted!.useFastModel,
    };
  });
}

export async function updateUserBudgetSettings(
  userId: string,
  input: z.infer<typeof updateBudgetSettingsSchema>,
) {
  return withUserDb(userId, async (tx) => {
    await getOrCreateUserSettings(userId);
    const [updated] = await tx
      .update(userSettings)
      .set({
        budgetRunUsd: String(input.budgetRunUsd),
        budgetProjectDayUsd: String(input.budgetProjectDayUsd),
        budgetUserMonthUsd: String(input.budgetUserMonthUsd),
        useFastModel: input.useFastModel,
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.theme ? { theme: input.theme } : {}),
      })
      .where(eq(userSettings.userId, userId))
      .returning();

    return {
      userId: updated!.userId,
      locale: updated!.locale,
      theme: updated!.theme,
      budgetRunUsd: Number(updated!.budgetRunUsd),
      budgetProjectDayUsd: Number(updated!.budgetProjectDayUsd),
      budgetUserMonthUsd: Number(updated!.budgetUserMonthUsd),
      useFastModel: updated!.useFastModel,
    };
  });
}

export async function getUserUsageSummary(userId: string) {
  return withUserDb(userId, async (tx) => {
    const rows = await tx
      .select()
      .from(usageMetrics)
      .where(eq(usageMetrics.userId, userId))
      .orderBy(desc(usageMetrics.day))
      .limit(60);

    const todayStr = new Date().toISOString().slice(0, 10);
    const monthPrefix = todayStr.slice(0, 7);

    let todayUsd = 0;
    let monthUsd = 0;
    let monthTokensIn = 0;
    let monthTokensOut = 0;

    for (const r of rows) {
      if (r.day === todayStr) todayUsd += r.costUsd;
      if (r.day.startsWith(monthPrefix)) {
        monthUsd += r.costUsd;
        monthTokensIn += r.tokensIn;
        monthTokensOut += r.tokensOut + r.tokensThinking;
      }
    }

    return {
      todayUsd: Number(todayUsd.toFixed(4)),
      monthUsd: Number(monthUsd.toFixed(4)),
      monthTokensIn,
      monthTokensOut,
      history: rows,
    };
  });
}

export async function exportUserAccountData(userId: string) {
  return withUserDb(userId, async (tx) => {
    const settings = await getOrCreateUserSettings(userId);
    const userProjects = await tx
      .select()
      .from(projects)
      .where(eq(projects.ownerId, userId));
    const keys = await listUserIntegrationsMasked(userId);
    const usage = await getUserUsageSummary(userId);

    return {
      exportedAt: new Date().toISOString(),
      userId,
      settings,
      integrationsMasked: keys,
      projects: userProjects,
      usage,
    };
  });
}

export async function deleteUserAccount(userId: string): Promise<void> {
  const adminDb = getAdminDb();
  await adminDb.execute(sql`DELETE FROM public.users WHERE id = ${userId}`);
}
