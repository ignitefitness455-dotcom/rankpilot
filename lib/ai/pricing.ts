/**
 * Gemini 4 Argon (`gemini-4-argon`) and fast-model pricing schedule.
 *
 * Verified against the Phase 0 pricing table (§10):
 * - Promotional window (through 2026-04-30 UTC) vs standard pricing (from 2026-05-01 UTC)
 * - Context tier split at 200,000 input tokens
 * - Implicit prefix cache hit tokens billed at 10% of the input rate (90% discount)
 * - Output + thinking tokens billed at the output rate
 * - Google Search grounding billed at $35 / 1,000 grounded requests ($0.035/req)
 */

export interface ModelRateCard {
  inputPerMillionLe200k: number;
  inputPerMillionGt200k: number;
  cachedPerMillionLe200k: number;
  cachedPerMillionGt200k: number;
  outputPerMillionLe200k: number;
  outputPerMillionGt200k: number;
  groundingPerRequestUsd: number;
}

const ARGON_PROMO_END_UTC = Date.parse("2026-05-01T00:00:00Z");

export const ARGON_INTRO_RATES: ModelRateCard = {
  inputPerMillionLe200k: 1.25,
  inputPerMillionGt200k: 2.5,
  cachedPerMillionLe200k: 0.125,
  cachedPerMillionGt200k: 0.25,
  outputPerMillionLe200k: 10.0,
  outputPerMillionGt200k: 15.0,
  groundingPerRequestUsd: 0.035,
};

export const ARGON_STANDARD_RATES: ModelRateCard = {
  inputPerMillionLe200k: 2.5,
  inputPerMillionGt200k: 5.0,
  cachedPerMillionLe200k: 0.25,
  cachedPerMillionGt200k: 0.5,
  outputPerMillionLe200k: 15.0,
  outputPerMillionGt200k: 22.5,
  groundingPerRequestUsd: 0.035,
};

export const FAST_MODEL_RATES: ModelRateCard = {
  inputPerMillionLe200k: 0.15,
  inputPerMillionGt200k: 0.3,
  cachedPerMillionLe200k: 0.0375,
  cachedPerMillionGt200k: 0.075,
  outputPerMillionLe200k: 0.6,
  outputPerMillionGt200k: 1.2,
  groundingPerRequestUsd: 0.035,
};

export function getRateCardForModel(model: string, at: Date = new Date()): ModelRateCard {
  const normalized = model.trim().toLowerCase();
  if (normalized.includes("flash") || normalized.includes("lite")) {
    return FAST_MODEL_RATES;
  }
  return at.getTime() < ARGON_PROMO_END_UTC ? ARGON_INTRO_RATES : ARGON_STANDARD_RATES;
}

export interface CostCalculationInput {
  model: string;
  tokensIn: number;
  tokensOut: number;
  tokensThinking?: number;
  tokensCached?: number;
  groundingRequests?: number;
  at?: Date;
}

export interface CostBreakdown {
  inputCostUsd: number;
  cachedCostUsd: number;
  outputCostUsd: number;
  groundingCostUsd: number;
  totalCostUsd: number;
}

/**
 * Calculates exact USD cost for a Gemini call from `usageMetadata`.
 * `tokensIn` is total prompt tokens (including `tokensCached`); we bill uncached
 * prompt tokens at the regular input rate and `tokensCached` at the 90%-discounted rate.
 */
export function calculateGeminiCost(input: CostCalculationInput): CostBreakdown {
  const rates = getRateCardForModel(input.model, input.at);
  const totalPrompt = Math.max(0, input.tokensIn);
  const cached = Math.min(totalPrompt, Math.max(0, input.tokensCached ?? 0));
  const uncachedPrompt = Math.max(0, totalPrompt - cached);
  const totalOutput = Math.max(0, input.tokensOut) + Math.max(0, input.tokensThinking ?? 0);
  const groundingCount = Math.max(0, input.groundingRequests ?? 0);

  const highContext = totalPrompt > 200_000;
  const inputRate = highContext ? rates.inputPerMillionGt200k : rates.inputPerMillionLe200k;
  const cachedRate = highContext ? rates.cachedPerMillionGt200k : rates.cachedPerMillionLe200k;
  const outputRate = highContext ? rates.outputPerMillionGt200k : rates.outputPerMillionLe200k;

  const inputCostUsd = (uncachedPrompt / 1_000_000) * inputRate;
  const cachedCostUsd = (cached / 1_000_000) * cachedRate;
  const outputCostUsd = (totalOutput / 1_000_000) * outputRate;
  const groundingCostUsd = groundingCount * rates.groundingPerRequestUsd;
  const totalCostUsd = Number(
    (inputCostUsd + cachedCostUsd + outputCostUsd + groundingCostUsd).toFixed(6),
  );

  return {
    inputCostUsd: Number(inputCostUsd.toFixed(6)),
    cachedCostUsd: Number(cachedCostUsd.toFixed(6)),
    outputCostUsd: Number(outputCostUsd.toFixed(6)),
    groundingCostUsd: Number(groundingCostUsd.toFixed(6)),
    totalCostUsd,
  };
}

/**
 * Estimates token count from UTF-8 text (~4 chars per token heuristic) for pre-flight
 * budget reservation before invoking the remote endpoint.
 */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimatePreFlightCostUsd(params: {
  model: string;
  promptTextLength: number;
  expectedOutputTokens?: number;
  thinkingLevel?: "LOW" | "MEDIUM" | "HIGH";
  useGrounding?: boolean;
  at?: Date;
}): { estimatedTokensIn: number; estimatedTokensOut: number; estimatedCostUsd: number } {
  const estimatedTokensIn = Math.max(64, Math.ceil(params.promptTextLength / 4));
  const baseOut = params.expectedOutputTokens ?? 1024;
  const thinkingMultiplier =
    params.thinkingLevel === "HIGH" ? 2.0 : params.thinkingLevel === "MEDIUM" ? 1.35 : 1.1;
  const estimatedTokensOut = Math.ceil(baseOut * thinkingMultiplier);

  const breakdown = calculateGeminiCost({
    model: params.model,
    tokensIn: estimatedTokensIn,
    tokensOut: estimatedTokensOut,
    tokensThinking: 0,
    tokensCached: 0,
    groundingRequests: params.useGrounding ? 1 : 0,
    at: params.at,
  });

  return {
    estimatedTokensIn,
    estimatedTokensOut,
    estimatedCostUsd: breakdown.totalCostUsd,
  };
}
