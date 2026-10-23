import { eq, sql } from "drizzle-orm";
import { projects, usageMetrics } from "@/lib/db/schema";
import { withUserDb } from "@/lib/db/rls";
import { getOrCreateUserSettings } from "@/lib/settings/service";

export type BudgetScope = "run" | "project_day" | "user_month";

export class BudgetExceededError extends Error {
  readonly status = 402;
  readonly scope: BudgetScope;
  readonly limitUsd: number;
  readonly usedUsd: number;
  readonly estimatedUsd: number;

  constructor(params: {
    scope: BudgetScope;
    limitUsd: number;
    usedUsd: number;
    estimatedUsd: number;
  }) {
    const scopeLabel =
      params.scope === "run"
        ? "per-run"
        : params.scope === "project_day"
          ? "project daily"
          : "monthly account";
    super(
      `AI ${scopeLabel} budget exceeded ($${(params.usedUsd + params.estimatedUsd).toFixed(4)} > $${params.limitUsd.toFixed(2)} limit). Adjust limits in Settings -> AI Budgets.`,
    );
    this.name = "BudgetExceededError";
    this.scope = params.scope;
    this.limitUsd = params.limitUsd;
    this.usedUsd = params.usedUsd;
    this.estimatedUsd = params.estimatedUsd;
  }
}

export interface BudgetContext {
  userId: string;
  projectId: string;
  runBudgetUsd?: number;
  runSpentUsd: number;
}

export interface BudgetLimitsSnapshot {
  budgetRunUsd: number;
  budgetProjectDayUsd: number;
  budgetUserMonthUsd: number;
  projectDayUsedUsd: number;
  userMonthUsedUsd: number;
  useFastModel: boolean;
}

/**
 * Loads current user & project budget caps plus today's project spend and this month's user spend.
 */
export async function getBudgetSnapshot(
  userId: string,
  projectId: string,
): Promise<BudgetLimitsSnapshot> {
  const settings = await getOrCreateUserSettings(userId);
  const todayStr = new Date().toISOString().slice(0, 10);
  const monthPrefix = todayStr.slice(0, 7);

  return withUserDb(userId, async (tx) => {
    const [projectRow] = await tx
      .select({ settings: projects.settings })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    const projectDayCap =
      projectRow?.settings?.budgetProjectDayUsd && projectRow.settings.budgetProjectDayUsd > 0
        ? projectRow.settings.budgetProjectDayUsd
        : settings.budgetProjectDayUsd;

    const usageRows = await tx
      .select()
      .from(usageMetrics)
      .where(eq(usageMetrics.userId, userId));

    let projectDayUsedUsd = 0;
    let userMonthUsedUsd = 0;

    for (const r of usageRows) {
      if (r.day === todayStr && r.projectId === projectId) {
        projectDayUsedUsd += r.costUsd;
      }
      if (r.day.startsWith(monthPrefix)) {
        userMonthUsedUsd += r.costUsd;
      }
    }

    return {
      budgetRunUsd: settings.budgetRunUsd,
      budgetProjectDayUsd: projectDayCap,
      budgetUserMonthUsd: settings.budgetUserMonthUsd,
      projectDayUsedUsd: Number(projectDayUsedUsd.toFixed(6)),
      userMonthUsedUsd: Number(userMonthUsedUsd.toFixed(6)),
      useFastModel: settings.useFastModel,
    };
  });
}

/**
 * Pure deterministic budget evaluator (unit-testable without DB).
 * Throws `BudgetExceededError` if `estimatedCallCostUsd` would breach any of the 3 caps.
 */
export function assertWithinBudgetCaps(params: {
  estimatedCallCostUsd: number;
  runSpentUsd: number;
  runLimitUsd: number;
  projectDayUsedUsd: number;
  projectDayLimitUsd: number;
  userMonthUsedUsd: number;
  userMonthLimitUsd: number;
}): void {
  const est = Math.max(0, params.estimatedCallCostUsd);

  if (params.runSpentUsd + est > params.runLimitUsd) {
    throw new BudgetExceededError({
      scope: "run",
      limitUsd: params.runLimitUsd,
      usedUsd: params.runSpentUsd,
      estimatedUsd: est,
    });
  }

  if (params.projectDayUsedUsd + est > params.projectDayLimitUsd) {
    throw new BudgetExceededError({
      scope: "project_day",
      limitUsd: params.projectDayLimitUsd,
      usedUsd: params.projectDayUsedUsd,
      estimatedUsd: est,
    });
  }

  if (params.userMonthUsedUsd + est > params.userMonthLimitUsd) {
    throw new BudgetExceededError({
      scope: "user_month",
      limitUsd: params.userMonthLimitUsd,
      usedUsd: params.userMonthUsedUsd,
      estimatedUsd: est,
    });
  }
}

/**
 * Pre-flight check before a Gemini API call.
 */
export async function checkPreFlightBudget(
  ctx: BudgetContext,
  estimatedCallCostUsd: number,
): Promise<BudgetLimitsSnapshot> {
  const snap = await getBudgetSnapshot(ctx.userId, ctx.projectId);
  const runLimit = ctx.runBudgetUsd ?? snap.budgetRunUsd;

  assertWithinBudgetCaps({
    estimatedCallCostUsd,
    runSpentUsd: ctx.runSpentUsd,
    runLimitUsd: runLimit,
    projectDayUsedUsd: snap.projectDayUsedUsd,
    projectDayLimitUsd: snap.budgetProjectDayUsd,
    userMonthUsedUsd: snap.userMonthUsedUsd,
    userMonthLimitUsd: snap.budgetUserMonthUsd,
  });

  return snap;
}

/**
 * Atomically records token & USD usage into `usage_metrics` after a Gemini call completes.
 */
export async function recordAiUsage(params: {
  userId: string;
  projectId: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  tokensThinking: number;
  tokensCached: number;
  groundingRequests: number;
  costUsd: number;
  day?: string;
}): Promise<void> {
  const day = params.day ?? new Date().toISOString().slice(0, 10);

  await withUserDb(params.userId, async (tx) => {
    await tx
      .insert(usageMetrics)
      .values({
        userId: params.userId,
        projectId: params.projectId,
        day,
        model: params.model,
        requests: 1,
        tokensIn: params.tokensIn,
        tokensOut: params.tokensOut,
        tokensThinking: params.tokensThinking,
        tokensCached: params.tokensCached,
        groundingRequests: params.groundingRequests,
        costUsd: params.costUsd,
      })
      .onConflictDoUpdate({
        target: [
          usageMetrics.userId,
          usageMetrics.projectId,
          usageMetrics.day,
          usageMetrics.model,
        ],
        set: {
          requests: sql`${usageMetrics.requests} + 1`,
          tokensIn: sql`${usageMetrics.tokensIn} + ${params.tokensIn}`,
          tokensOut: sql`${usageMetrics.tokensOut} + ${params.tokensOut}`,
          tokensThinking: sql`${usageMetrics.tokensThinking} + ${params.tokensThinking}`,
          tokensCached: sql`${usageMetrics.tokensCached} + ${params.tokensCached}`,
          groundingRequests: sql`${usageMetrics.groundingRequests} + ${params.groundingRequests}`,
          costUsd: sql`${usageMetrics.costUsd} + ${params.costUsd}`,
        },
      });
  });
}
