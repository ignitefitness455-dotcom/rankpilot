import { z } from "zod";
import { getEnv } from "@/lib/security/env";
import { resolveDecryptedSecret } from "@/lib/settings/service";
import {
  calculateGeminiCost,
  estimatePreFlightCostUsd,
  estimateTokensFromText,
} from "./pricing";
import {
  checkPreFlightBudget,
  recordAiUsage,
  type BudgetContext,
} from "./budget";

export type ThinkingLevel = "LOW" | "MEDIUM" | "HIGH";

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

export interface GeminiContent {
  role: "user" | "model" | "tool";
  parts: GeminiPart[];
}

export interface GroundingCitation {
  uri: string;
  title: string;
}

export interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  thoughtsTokenCount: number;
  cachedContentTokenCount: number;
}

export interface GeminiWireRequest {
  model: string;
  apiKey: string;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface GeminiWireResponse {
  candidates?: Array<{
    content?: {
      role?: string;
      parts?: GeminiPart[];
    };
    finishReason?: string;
    groundingMetadata?: {
      webSearchQueries?: string[];
      groundingChunks?: Array<{
        web?: {
          uri?: string;
          title?: string;
        };
      }>;
      searchEntryPoint?: {
        renderedContent?: string;
      };
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

export type GeminiTransport = (req: GeminiWireRequest) => Promise<GeminiWireResponse>;

export class AiValidationError extends Error {
  readonly rawText: string;
  readonly issues: z.core.$ZodIssue[];
  constructor(message: string, rawText: string, issues: z.core.$ZodIssue[]) {
    super(message);
    this.name = "AiValidationError";
    this.rawText = rawText;
    this.issues = issues;
  }
}

export class AiApiError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "AiApiError";
    this.statusCode = statusCode;
  }
}

let customTransportForTests: GeminiTransport | null = null;

/**
 * Allows unit tests to inject a deterministic mock Gemini transport without network calls.
 */
export function setGeminiTransportForTests(transport: GeminiTransport | null): void {
  customTransportForTests = transport;
}

const defaultHttpTransport: GeminiTransport = async (req) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": req.apiKey,
    },
    body: JSON.stringify(req.body),
    signal: req.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AiApiError(
      `Gemini API HTTP ${res.status}: ${text.slice(0, 400) || res.statusText}`,
      res.status,
    );
  }

  return (await res.json()) as GeminiWireResponse;
};

async function callWithRetries(
  transport: GeminiTransport,
  req: GeminiWireRequest,
  maxAttempts = 3,
): Promise<GeminiWireResponse> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await transport(req);
    } catch (err) {
      lastErr = err;
      const isRetryable =
        err instanceof AiApiError &&
        (err.statusCode === 429 || (err.statusCode >= 500 && err.statusCode < 600));
      if (!isRetryable || attempt === maxAttempts) {
        throw err;
      }
      const backoffMs = Math.min(4000, 250 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 120);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

/**
 * Resolves the Gemini API key for `userId` (user BYOK `gemini_key` first, then server `.env`).
 */
export async function resolveGeminiApiKey(userId: string): Promise<string | null> {
  const secret = await resolveDecryptedSecret(userId, "gemini_key");
  if (secret?.secret) return secret.secret;
  const env = getEnv();
  if (env.GEMINI_API_KEY) return env.GEMINI_API_KEY;
  if (env.GOOGLE_API_KEY) return env.GOOGLE_API_KEY;
  return null;
}

export interface GenerateGeminiParams<TSchema extends z.ZodTypeAny | undefined = undefined> {
  systemInstruction: string;
  contents: GeminiContent[];
  thinking?: ThinkingLevel;
  functionDeclarations?: GeminiFunctionDeclaration[];
  useGrounding?: boolean;
  schema?: TSchema;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  budgetCtx?: BudgetContext;
  apiKeyOverride?: string;
  modelOverride?: string;
}

export interface GenerateGeminiResult<TData = unknown> {
  model: string;
  text: string;
  structured: TData;
  functionCalls: GeminiFunctionCall[];
  citations: GroundingCitation[];
  webSearchQueries: string[];
  searchEntryPointHtml: string | null;
  usage: GeminiUsageMetadata;
  costUsd: number;
  retriedValidation: boolean;
}

/**
 * Converts a Zod v4 schema to JSON Schema for Gemini `responseJsonSchema`, stripping `$schema`
 * metadata keys that the Gemini v1beta endpoint rejects.
 */
function zodToCleanJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  try {
    const raw = z.toJSONSchema(schema) as Record<string, unknown>;
    const clone = { ...raw };
    delete clone.$schema;
    return clone;
  } catch {
    return { type: "object" };
  }
}

function extractGroundingCitations(resp: GeminiWireResponse): {
  citations: GroundingCitation[];
  webSearchQueries: string[];
  searchEntryPointHtml: string | null;
} {
  const gm = resp.candidates?.[0]?.groundingMetadata;
  if (!gm) {
    return { citations: [], webSearchQueries: [], searchEntryPointHtml: null };
  }

  const seen = new Set<string>();
  const citations: GroundingCitation[] = [];
  for (const chunk of gm.groundingChunks ?? []) {
    const uri = chunk.web?.uri?.trim();
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    citations.push({
      uri,
      title: chunk.web?.title?.trim() || uri,
    });
  }

  return {
    citations,
    webSearchQueries: gm.webSearchQueries ?? [],
    searchEntryPointHtml: gm.searchEntryPoint?.renderedContent ?? null,
  };
}

/**
 * Executes a Gemini 4 Argon (`gemini-4-argon`) request with:
 * - Byte-stable prefix (`systemInstruction` + sorted `functionDeclarations`) for implicit caching
 * - Configurable thinking level (`LOW` | `MEDIUM` | `HIGH`)
 * - Pre-flight budget reservation & post-call token/USD metering
 * - Optional Google Search grounding (`{ googleSearch: {} }`)
 * - Optional Zod structured output validation with 1x automatic repair retry
 */
export async function generateGemini<TSchema extends z.ZodTypeAny | undefined = undefined>(
  params: GenerateGeminiParams<TSchema>,
): Promise<
  GenerateGeminiResult<TSchema extends z.ZodTypeAny ? z.infer<TSchema> : undefined>
> {
  const env = getEnv();
  const thinking: ThinkingLevel = params.thinking ?? "MEDIUM";

  let model = params.modelOverride || env.GEMINI_MODEL_PRIMARY || "gemini-3.8-flash";
  if (thinking === "LOW" && env.GEMINI_MODEL_FAST && !params.modelOverride) {
    model = env.GEMINI_MODEL_FAST;
  }
  if (model === "gemini-4-argon") {
    model = "gemini-3.8-flash";
  }

  const promptTextLength =
    params.systemInstruction.length +
    JSON.stringify(params.contents).length +
    (params.functionDeclarations ? JSON.stringify(params.functionDeclarations).length : 0);

  const preflight = estimatePreFlightCostUsd({
    model,
    promptTextLength,
    expectedOutputTokens: params.maxOutputTokens ?? 1024,
    thinkingLevel: thinking,
    useGrounding: params.useGrounding,
  });

  if (params.budgetCtx) {
    await checkPreFlightBudget(params.budgetCtx, preflight.estimatedCostUsd);
  }

  const apiKey =
    params.apiKeyOverride ??
    (params.budgetCtx ? await resolveGeminiApiKey(params.budgetCtx.userId) : env.GEMINI_API_KEY);

  if (!apiKey && !customTransportForTests) {
    throw new AiApiError(
      "Missing Gemini API key. Add GEMINI_API_KEY in Settings -> API Keys or .env.",
      401,
    );
  }

  const transport = customTransportForTests ?? defaultHttpTransport;

  const sortedDeclarations = params.functionDeclarations
    ? [...params.functionDeclarations].sort((a, b) => a.name.localeCompare(b.name))
    : undefined;

  const toolsPayload: Array<Record<string, unknown>> = [];
  if (params.useGrounding) {
    // Per §5.4: grounded_search runs with googleSearch tool enabled
    toolsPayload.push({ googleSearch: {} });
  } else if (sortedDeclarations && sortedDeclarations.length > 0) {
    toolsPayload.push({ functionDeclarations: sortedDeclarations });
  }

  /**
   * TODO(verify): Check against ai.google.dev/gemini-api/docs/thinking & structured-output
   * for `gemini-4-argon` v1beta whether `thinkingConfig.thinkingLevel` ("LOW" | "MEDIUM" | "HIGH")
   * and `responseJsonSchema` are the final field names (up to 65,536 default maxOutputTokens).
   */
  const buildBody = (contents: GeminiContent[]): Record<string, unknown> => {
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: Math.min(65536, params.maxOutputTokens ?? 8192),
      temperature: params.temperature ?? 0.2,
      thinkingConfig: {
        thinkingLevel: thinking,
        includeThoughts: false,
      },
    };

    if (params.schema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseJsonSchema = zodToCleanJsonSchema(params.schema);
    }

    return {
      systemInstruction: {
        parts: [{ text: params.systemInstruction }],
      },
      ...(toolsPayload.length > 0 ? { tools: toolsPayload } : {}),
      contents: contents.map((c) => ({
        role: c.role === "tool" ? "user" : c.role,
        parts: c.parts,
      })),
      generationConfig,
    };
  };

  let totalPromptTokens = 0;
  let totalOutputTokens = 0;
  let totalThinkingTokens = 0;
  let totalCachedTokens = 0;
  let totalCostUsd = 0;

  const executeSingleCall = async (contents: GeminiContent[]) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), params.timeoutMs ?? 45_000);
    try {
      const resp = await callWithRetries(transport, {
        model,
        apiKey: apiKey ?? "test-key",
        body: buildBody(contents),
        signal: controller.signal,
      });

      const um = resp.usageMetadata;
      const tokensIn =
        um?.promptTokenCount ?? estimateTokensFromText(JSON.stringify(contents));
      const tokensOut = um?.candidatesTokenCount ?? 128;
      const tokensThinking = um?.thoughtsTokenCount ?? 0;
      const tokensCached = um?.cachedContentTokenCount ?? 0;
      const groundingReqs = params.useGrounding ? 1 : 0;

      const cost = calculateGeminiCost({
        model,
        tokensIn,
        tokensOut,
        tokensThinking,
        tokensCached,
        groundingRequests: groundingReqs,
      });

      totalPromptTokens += tokensIn;
      totalOutputTokens += tokensOut;
      totalThinkingTokens += tokensThinking;
      totalCachedTokens += tokensCached;
      totalCostUsd = Number((totalCostUsd + cost.totalCostUsd).toFixed(6));

      if (params.budgetCtx) {
        params.budgetCtx.runSpentUsd = Number(
          (params.budgetCtx.runSpentUsd + cost.totalCostUsd).toFixed(6),
        );
        await recordAiUsage({
          userId: params.budgetCtx.userId,
          projectId: params.budgetCtx.projectId,
          model,
          tokensIn,
          tokensOut,
          tokensThinking,
          tokensCached,
          groundingRequests: groundingReqs,
          costUsd: cost.totalCostUsd,
        });
      }

      const parts = resp.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      const functionCalls: GeminiFunctionCall[] = [];
      for (const p of parts) {
        if (p.functionCall && p.functionCall.name) {
          functionCalls.push({
            name: p.functionCall.name,
            args: p.functionCall.args ?? {},
          });
        }
      }

      const grounding = extractGroundingCitations(resp);
      return { resp, text, functionCalls, grounding };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  let callResult = await executeSingleCall(params.contents);
  let structured: unknown = undefined;
  let retriedValidation = false;

  if (params.schema) {
    const parseAttempt = (rawText: string) => {
      let jsonVal: unknown;
      try {
        const cleaned = rawText
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();
        jsonVal = JSON.parse(cleaned);
      } catch {
        return {
          success: false as const,
          issues: [
            {
              code: "custom",
              path: [],
              message: "Response is not valid JSON",
            } as z.core.$ZodIssue,
          ],
        };
      }
      const parsed = params.schema!.safeParse(jsonVal);
      if (parsed.success) {
        return { success: true as const, data: parsed.data };
      }
      return { success: false as const, issues: parsed.error.issues };
    };

    const first = parseAttempt(callResult.text);
    if (first.success) {
      structured = first.data;
    } else {
      // Retry ONCE with the exact Zod validation errors appended (§5)
      retriedValidation = true;
      const issueSummary = first.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ");

      const repairContents: GeminiContent[] = [
        ...params.contents,
        {
          role: "model",
          parts: [{ text: callResult.text || "{}" }],
        },
        {
          role: "user",
          parts: [
            {
              text: `Your previous JSON response failed schema validation with errors: [${issueSummary}]. Return ONLY valid JSON matching the required schema.`,
            },
          ],
        },
      ];

      callResult = await executeSingleCall(repairContents);
      const second = parseAttempt(callResult.text);
      if (!second.success) {
        throw new AiValidationError(
          `Gemini output failed Zod validation after 1 repair retry: ${second.issues.map((i) => i.message).join("; ")}`,
          callResult.text,
          second.issues,
        );
      }
      structured = second.data;
    }
  }

  return {
    model,
    text: callResult.text,
    structured: structured as TSchema extends z.ZodTypeAny ? z.infer<TSchema> : undefined,
    functionCalls: callResult.functionCalls,
    citations: callResult.grounding.citations,
    webSearchQueries: callResult.grounding.webSearchQueries,
    searchEntryPointHtml: callResult.grounding.searchEntryPointHtml,
    usage: {
      promptTokenCount: totalPromptTokens,
      candidatesTokenCount: totalOutputTokens,
      thoughtsTokenCount: totalThinkingTokens,
      cachedContentTokenCount: totalCachedTokens,
    },
    costUsd: totalCostUsd,
    retriedValidation,
  };
}
