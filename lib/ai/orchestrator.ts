import { EventEmitter } from "node:events";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withUserDb } from "@/lib/db/rls";
import {
  approvals,
  chatMessages,
  ignoredRules,
  projectProfiles,
  runs,
  runSteps,
  tasks,
  type RunStatus,
  type RunStepType,
} from "@/lib/db/schema";
import { DEFAULT_PROFILE_FIELDS, serializeProjectProfile } from "@/lib/projects/profile";
import { assertProjectAccess, NotFoundError } from "@/lib/security/authz";
import { sha256Hex } from "@/lib/security/crypto";
import { getEnv } from "@/lib/security/env";
import {
  BudgetExceededError,
  getBudgetSnapshot,
  type BudgetContext,
} from "./budget";
import {
  AiApiError,
  generateGemini,
  resolveGeminiApiKey,
  type GeminiContent,
  type ThinkingLevel,
} from "./gemini";
import { evaluateWhiteHatPolicy } from "./guardrails";
import { buildCachedSystemInstruction, computePrefixFingerprint } from "./prefix";
import {
  computeTaskPriorityScore,
  executeAgentTool,
  getSortedToolDeclarations,
  type AgentName,
  type ToolExecutionContext,
} from "./tools";

export interface AgentEvidenceItem {
  source: string;
  label: string;
  value: string;
  url?: string;
  isEstimate?: boolean;
  confidence?: number;
  timestamp: string;
}

export interface AgentProposedAction {
  id: string;
  title: string;
  description: string;
  impact: number;
  effort: number;
  confidence: number;
  ruleId?: string;
  fixSnippet?: string;
  status: "pending" | "approved" | "dismissed";
  taskId?: string;
}

export const agentFinalResponseSchema = z.object({
  answerMarkdown: z.string().min(1),
  evidence: z
    .array(
      z.object({
        source: z.string(),
        label: z.string(),
        value: z.string(),
        url: z.string().optional(),
        isEstimate: z.boolean().optional(),
        confidence: z.number().min(0).max(1).optional(),
        timestamp: z.string().optional(),
      }),
    )
    .default([]),
  proposedActions: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        impact: z.number().int().min(1).max(5),
        effort: z.number().int().min(1).max(5),
        confidence: z.number().min(0.05).max(1),
        ruleId: z.string().optional(),
        fixSnippet: z.string().optional(),
      }),
    )
    .default([]),
});

export interface RunStreamEvent {
  runId: string;
  status: RunStatus;
  step?: {
    idx: number;
    type: RunStepType;
    summary: string;
    toolName?: string | null;
    tokens: number;
    costUsd: number;
    durationMs: number;
    status: "ok" | "error" | "blocked";
  };
  tokensIn?: number;
  tokensOut?: number;
  tokensCached?: number;
  costUsd?: number;
  done?: boolean;
}

const runEmitter = new EventEmitter();
runEmitter.setMaxListeners(100);
const cancelledRuns = new Set<string>();

export function subscribeRunEvents(
  runId: string,
  listener: (ev: RunStreamEvent) => void,
): () => void {
  const channel = `run:${runId}`;
  runEmitter.on(channel, listener);
  return () => {
    runEmitter.off(channel, listener);
  };
}

function emitRunEvent(ev: RunStreamEvent): void {
  runEmitter.emit(`run:${ev.runId}`, ev);
}

/**
 * Classifies user query to route to the best specialist agent when `Orchestrator` (Auto) is selected.
 */
export function selectSpecialistForPrompt(
  prompt: string,
  requestedAgent?: AgentName,
): { agent: AgentName; thinking: ThinkingLevel } {
  if (requestedAgent && requestedAgent !== "Orchestrator") {
    const thinking: ThinkingLevel =
      requestedAgent === "Technical" || requestedAgent === "Performance" ? "HIGH" : "MEDIUM";
    return { agent: requestedAgent, thinking };
  }

  const lower = prompt.toLowerCase();
  if (
    /\b(quick\s*win|ctr|decay|losing\s+traffic|cannibal|gsc|search\s+console|impressions|clicks|ga4|analytics)\b/.test(
      lower,
    )
  ) {
    return { agent: "Performance", thinking: "MEDIUM" };
  }
  if (
    /\b(crawl|robots\.txt|sitemap|canonical|redirect|404|500|status\s+code|orphan|cwv|lcp|cls|inp|pagespeed|technical|audit|health\s+score)\b/.test(
      lower,
    )
  ) {
    return { agent: "Technical", thinking: "MEDIUM" };
  }
  if (/\b(title|meta\s+description|h1|heading|on[- ]page|internal\s+link|anchor)\b/.test(lower)) {
    return { agent: "OnPage", thinking: "MEDIUM" };
  }
  if (/\b(keyword|cluster|intent|search\s+volume|topic)\b/.test(lower)) {
    return { agent: "Keyword", thinking: "MEDIUM" };
  }
  if (/\b(schema|json-ld|structured\s+data)\b/.test(lower)) {
    return { agent: "Schema", thinking: "MEDIUM" };
  }
  if (/\b(ai\s+overview|llms\.txt|gptbot|perplexity|geo|citation)\b/.test(lower)) {
    return { agent: "GEO", thinking: "MEDIUM" };
  }
  return { agent: "Orchestrator", thinking: "HIGH" };
}

function buildRoleBlockForSpecialist(
  agent: AgentName,
  ignoredRuleIds: string[],
): string {
  const ignoredNote =
    ignoredRuleIds.length > 0
      ? `<ignored_rules>${ignoredRuleIds.join(", ")}</ignored_rules>`
      : `<ignored_rules>none</ignored_rules>`;

  return [
    `<specialist_role agent="${agent}">`,
    `You are operating as RankPilot's ${agent} Specialist.`,
    `Always call read-only tools first to gather measured evidence from the project database before answering.`,
    `Never re-suggest any rule listed in ${ignoredNote}.`,
    `</specialist_role>`,
  ].join("\n");
}

export interface RunAgentChatParams {
  userId: string;
  projectId: string;
  message: string;
  requestedAgent?: AgentName;
  locale?: string;
}

export interface RunAgentChatOutput {
  runId: string;
  agent: AgentName;
  status: RunStatus;
  mode: "gemini_4_argon" | "local_evidence_fallback" | "policy_blocked";
  prefixFingerprint: string;
  assistantMessage: {
    id: string;
    content: string;
    evidence: AgentEvidenceItem[];
    actions: AgentProposedAction[];
    createdAt: string;
  };
  steps: Array<{
    idx: number;
    type: RunStepType;
    summary: string;
    toolName: string | null;
    tokens: number;
    costUsd: number;
    durationMs: number;
    status: "ok" | "error" | "blocked";
  }>;
  metrics: {
    tokensIn: number;
    tokensOut: number;
    tokensThinking: number;
    tokensCached: number;
    costUsd: number;
    budgetUsd: number;
  };
}

/**
 * Executes a bounded `plan -> act -> observe -> verify` agent run for "Ask the Agent".
 */
export async function runAgentChat(params: RunAgentChatParams): Promise<RunAgentChatOutput> {
  const env = getEnv();
  const maxSteps = env.AI_MAX_STEPS;
  const { agent, thinking } = selectSpecialistForPrompt(params.message, params.requestedAgent);

  // Load project, profile, ignored_rules, and user budget snapshot
  const budgetSnap = await getBudgetSnapshot(params.userId, params.projectId);
  const projectCtx = await withUserDb(params.userId, async (tx) => {
    const { project } = await assertProjectAccess(tx, params.userId, params.projectId, "viewer");
    const [profile] = await tx
      .select()
      .from(projectProfiles)
      .where(eq(projectProfiles.projectId, params.projectId))
      .limit(1);
    const ignored = await tx
      .select()
      .from(ignoredRules)
      .where(eq(ignoredRules.projectId, params.projectId));

    const profileText =
      profile?.profileText ??
      serializeProjectProfile({
        projectId: project.id,
        name: project.name,
        url: project.url,
        host: project.host,
        cms: project.cms,
        language: project.language,
        version: 1,
        fields: DEFAULT_PROFILE_FIELDS,
      });

    const [createdRun] = await tx
      .insert(runs)
      .values({
        projectId: params.projectId,
        userId: params.userId,
        kind: "chat",
        agent,
        status: "running",
        input: { message: params.message, requestedAgent: params.requestedAgent ?? "Orchestrator" },
        budgetUsd: budgetSnap.budgetRunUsd,
        startedAt: new Date(),
      })
      .returning();

    await tx.insert(chatMessages).values({
      projectId: params.projectId,
      runId: createdRun!.id,
      role: "user",
      content: params.message,
      evidence: [],
      actions: [],
    });

    return {
      project,
      profileText,
      ignoredRuleIds: ignored.map((i) => i.ruleId).filter((r): r is string => Boolean(r)),
      run: createdRun!,
    };
  });

  const runId = projectCtx.run.id;
  const toolDeclarations = getSortedToolDeclarations();
  const systemInstruction = buildCachedSystemInstruction(projectCtx.profileText);
  const prefixFingerprint = computePrefixFingerprint(
    systemInstruction,
    toolDeclarations.map((d) => d.name),
  );

  let stepIdx = 0;
  const recordedSteps: RunAgentChatOutput["steps"] = [];

  const appendStep = async (stepInput: {
    type: RunStepType;
    summary: string;
    toolName?: string | null;
    args?: unknown;
    result?: unknown;
    tokens?: number;
    costUsd?: number;
    durationMs?: number;
    status?: "ok" | "error" | "blocked";
  }) => {
    stepIdx += 1;
    const currentIdx = stepIdx;
    const row = {
      idx: currentIdx,
      type: stepInput.type,
      summary: stepInput.summary,
      toolName: stepInput.toolName ?? null,
      tokens: stepInput.tokens ?? 0,
      costUsd: Number((stepInput.costUsd ?? 0).toFixed(6)),
      durationMs: stepInput.durationMs ?? 0,
      status: stepInput.status ?? ("ok" as const),
    };
    recordedSteps.push(row);

    await withUserDb(params.userId, async (tx) => {
      await tx.insert(runSteps).values({
        projectId: params.projectId,
        runId,
        idx: currentIdx,
        type: row.type,
        summary: row.summary,
        toolName: row.toolName,
        args: stepInput.args ?? null,
        result: stepInput.result ?? null,
        tokens: row.tokens,
        costUsd: row.costUsd,
        durationMs: row.durationMs,
        status: row.status,
      });
    });

    emitRunEvent({
      runId,
      status: "running",
      step: row,
    });
  };

  // STEP 0: White-Hat Policy Gate (§4.2 & §5.8)
  const policyCheck = evaluateWhiteHatPolicy(params.message);
  if (!policyCheck.allowed) {
    await appendStep({
      type: "verify",
      summary: `Blocked by White-Hat Spam Policy Gate (${policyCheck.violationCategory})`,
      status: "blocked",
      durationMs: 2,
    });

    const refusalContent = [
      `### White-Hat Policy Refusal (${policyCheck.violationCategory?.replace(/_/g, " ")})`,
      policyCheck.refusalMessage,
      "",
      `**Why this matters:** ${policyCheck.reason}`,
      "",
      `**Compliant White-Hat Alternative:** ${policyCheck.whiteHatAlternative}`,
    ].join("\n");

    const [savedMsg] = await withUserDb(params.userId, async (tx) => {
      await tx
        .update(runs)
        .set({
          status: "succeeded",
          stepsCount: stepIdx,
          output: { policyBlocked: true, category: policyCheck.violationCategory },
          finishedAt: new Date(),
        })
        .where(eq(runs.id, runId));

      return tx
        .insert(chatMessages)
        .values({
          projectId: params.projectId,
          runId,
          role: "assistant",
          content: refusalContent,
          evidence: [
            {
              source: "google_search_essentials",
              label: "Spam Policy Enforcement",
              value: policyCheck.violationCategory ?? "policy_violation",
              timestamp: new Date().toISOString(),
            },
          ],
          actions: [],
        })
        .returning();
    });

    emitRunEvent({ runId, status: "succeeded", done: true });

    return {
      runId,
      agent,
      status: "succeeded",
      mode: "policy_blocked",
      prefixFingerprint,
      assistantMessage: {
        id: savedMsg!.id,
        content: savedMsg!.content,
        evidence: (savedMsg!.evidence as AgentEvidenceItem[]) ?? [],
        actions: [],
        createdAt: savedMsg!.createdAt.toISOString(),
      },
      steps: recordedSteps,
      metrics: {
        tokensIn: 0,
        tokensOut: 0,
        tokensThinking: 0,
        tokensCached: 0,
        costUsd: 0,
        budgetUsd: budgetSnap.budgetRunUsd,
      },
    };
  }

  const budgetCtx: BudgetContext = {
    userId: params.userId,
    projectId: params.projectId,
    runBudgetUsd: budgetSnap.budgetRunUsd,
    runSpentUsd: 0,
  };

  const toolCtx: ToolExecutionContext = {
    userId: params.userId,
    projectId: params.projectId,
    systemInstruction,
    budgetCtx,
  };

  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalTokensThinking = 0;
  let totalTokensCached = 0;
  let mode: "gemini_4_argon" | "local_evidence_fallback" = "gemini_4_argon";

  let finalAnswerMd = "";
  let rawEvidence: AgentEvidenceItem[] = [];
  let rawActions: AgentProposedAction[] = [];
  let finalStatus: RunStatus = "succeeded";

  const hasLiveKey = Boolean(await resolveGeminiApiKey(params.userId));

  try {
    await appendStep({
      type: "plan",
      summary: `Routing request to ${agent} Specialist (thinking=${thinking}, prefix=${prefixFingerprint.slice(0, 8)})`,
      durationMs: 5,
    });

    if (hasLiveKey) {
      const conversation: GeminiContent[] = [
        {
          role: "user",
          parts: [
            {
              text: `${buildRoleBlockForSpecialist(agent, projectCtx.ignoredRuleIds)}\n\nUser Question (${params.locale === "bn" ? "Reply in Bengali / বাংলা where natural, keeping URLs and code in English" : "Reply in English"}):\n${params.message}`,
            },
          ],
        },
      ];

      let remainingLoops = Math.min(maxSteps, 6);
      while (remainingLoops > 0) {
        if (cancelledRuns.has(runId)) {
          finalStatus = "cancelled";
          break;
        }
        remainingLoops -= 1;

        const stepStart = Date.now();
        const turn = await generateGemini({
          systemInstruction,
          contents: conversation,
          thinking,
          functionDeclarations: toolDeclarations,
          budgetCtx,
        });

        totalTokensIn += turn.usage.promptTokenCount;
        totalTokensOut += turn.usage.candidatesTokenCount;
        totalTokensThinking += turn.usage.thoughtsTokenCount;
        totalTokensCached += turn.usage.cachedContentTokenCount;

        if (turn.functionCalls.length === 0) {
          break;
        }

        // Record model's functionCall turn
        conversation.push({
          role: "model",
          parts: turn.functionCalls.map((fc) => ({ functionCall: fc })),
        });

        const responseParts = [];
        for (const fc of turn.functionCalls) {
          await appendStep({
            type: "tool_call",
            summary: `Calling tool ${fc.name}`,
            toolName: fc.name,
            args: fc.args,
            tokens: turn.usage.promptTokenCount,
            costUsd: turn.costUsd / Math.max(1, turn.functionCalls.length),
            durationMs: Date.now() - stepStart,
          });

          const outcome = await executeAgentTool({
            agent,
            toolName: fc.name,
            rawArgs: fc.args,
            ctx: toolCtx,
          });

          await appendStep({
            type: "tool_result",
            summary: outcome.ok
              ? `Tool ${fc.name} returned evidence (${outcome.durationMs}ms)`
              : `Tool ${fc.name} failed/blocked: ${String(outcome.result.message ?? outcome.result.error)}`,
            toolName: fc.name,
            result: outcome.result,
            durationMs: outcome.durationMs,
            status: outcome.blockedByAllowlist ? "blocked" : outcome.ok ? "ok" : "error",
          });

          responseParts.push({
            functionResponse: {
              name: fc.name,
              response: outcome.result,
            },
          });
        }

        conversation.push({
          role: "tool",
          parts: responseParts,
        });
      }

      if (finalStatus !== "cancelled") {
        // Final structured synthesis pass validated with Zod (1x auto-repair retry inside generateGemini)
        conversation.push({
          role: "user",
          parts: [
            {
              text: "Synthesize your final response in JSON matching the schema: include `answerMarkdown`, `evidence` (every metric must trace to a tool result above), and `proposedActions` (with impact 1-5, effort 1-5, confidence 0-1, and exact fixSnippet).",
            },
          ],
        });

        const synthStart = Date.now();
        const finalTurn = await generateGemini({
          systemInstruction,
          contents: conversation,
          thinking: "MEDIUM",
          schema: agentFinalResponseSchema,
          budgetCtx,
        });

        totalTokensIn += finalTurn.usage.promptTokenCount;
        totalTokensOut += finalTurn.usage.candidatesTokenCount;
        totalTokensThinking += finalTurn.usage.thoughtsTokenCount;
        totalTokensCached += finalTurn.usage.cachedContentTokenCount;

        finalAnswerMd = finalTurn.structured.answerMarkdown;
        rawEvidence = finalTurn.structured.evidence.map((e) => ({
          source: e.source,
          label: e.label,
          value: e.value,
          url: e.url,
          isEstimate: e.isEstimate,
          confidence: e.confidence,
          timestamp: e.timestamp ?? new Date().toISOString(),
        }));
        rawActions = finalTurn.structured.proposedActions.map((a) => ({
          id: crypto.randomUUID(),
          title: a.title,
          description: a.description,
          impact: a.impact,
          effort: a.effort,
          confidence: a.confidence,
          ruleId: a.ruleId,
          fixSnippet: a.fixSnippet,
          status: "pending" as const,
        }));

        await appendStep({
          type: "message",
          summary: `Synthesized structured answer (${rawEvidence.length} evidence items, ${rawActions.length} actions)${finalTurn.retriedValidation ? " [1x schema auto-repair]" : ""}`,
          tokens: finalTurn.usage.candidatesTokenCount,
          costUsd: finalTurn.costUsd,
          durationMs: Date.now() - synthStart,
        });
      }
    } else {
      // Evidence-First Local Fallback when no GEMINI_API_KEY is configured
      mode = "local_evidence_fallback";
      const localSynth = await runLocalEvidenceSynthesis({
        agent,
        message: params.message,
        projectUrl: projectCtx.project.url,
        toolCtx,
        appendStep,
      });
      finalAnswerMd = localSynth.answerMarkdown;
      rawEvidence = localSynth.evidence;
      rawActions = localSynth.proposedActions;
    }

    // STEP: Deterministic Verify Gate (§5.2)
    const verifyStart = Date.now();
    const ignoredSet = new Set(projectCtx.ignoredRuleIds);
    const verifiedActions = rawActions.filter(
      (a) => !a.ruleId || !ignoredSet.has(a.ruleId),
    );
    const filteredCount = rawActions.length - verifiedActions.length;

    await appendStep({
      type: "verify",
      summary: `Verified ${rawEvidence.length} evidence citations and ${verifiedActions.length} proposed actions (${filteredCount} filtered by ignored_rules)`,
      durationMs: Date.now() - verifyStart,
    });

    rawActions = verifiedActions;
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      finalStatus = "budget_exceeded";
      finalAnswerMd = `⚠️ **Budget Limit Reached:** ${err.message}`;
      await appendStep({
        type: "error",
        summary: err.message,
        status: "blocked",
      });
    } else if (err instanceof AiApiError && err.statusCode === 401) {
      // Fallback to local evidence synthesis if key was rejected
      mode = "local_evidence_fallback";
      const localSynth = await runLocalEvidenceSynthesis({
        agent,
        message: params.message,
        projectUrl: projectCtx.project.url,
        toolCtx,
        appendStep,
      });
      finalAnswerMd = localSynth.answerMarkdown;
      rawEvidence = localSynth.evidence;
      rawActions = localSynth.proposedActions;
    } else {
      finalStatus = "failed";
      const errMsg = err instanceof Error ? err.message : String(err);
      finalAnswerMd = `⚠️ **Agent Run Error:** ${errMsg}`;
      await appendStep({
        type: "error",
        summary: errMsg,
        status: "error",
      });
    }
  }

  const [savedAssistantMsg] = await withUserDb(params.userId, async (tx) => {
    await tx
      .update(runs)
      .set({
        status: finalStatus,
        stepsCount: stepIdx,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        tokensThinking: totalTokensThinking,
        tokensCached: totalTokensCached,
        costUsd: budgetCtx.runSpentUsd,
        output: {
          mode,
          prefixFingerprint,
          evidenceCount: rawEvidence.length,
          actionsCount: rawActions.length,
        },
        finishedAt: new Date(),
      })
      .where(eq(runs.id, runId));

    return tx
      .insert(chatMessages)
      .values({
        projectId: params.projectId,
        runId,
        role: "assistant",
        content: finalAnswerMd,
        evidence: rawEvidence,
        actions: rawActions,
      })
      .returning();
  });

  emitRunEvent({
    runId,
    status: finalStatus,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    tokensCached: totalTokensCached,
    costUsd: budgetCtx.runSpentUsd,
    done: true,
  });

  return {
    runId,
    agent,
    status: finalStatus,
    mode,
    prefixFingerprint,
    assistantMessage: {
      id: savedAssistantMsg!.id,
      content: savedAssistantMsg!.content,
      evidence: (savedAssistantMsg!.evidence as AgentEvidenceItem[]) ?? [],
      actions: (savedAssistantMsg!.actions as AgentProposedAction[]) ?? [],
      createdAt: savedAssistantMsg!.createdAt.toISOString(),
    },
    steps: recordedSteps,
    metrics: {
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      tokensThinking: totalTokensThinking,
      tokensCached: totalTokensCached,
      costUsd: budgetCtx.runSpentUsd,
      budgetUsd: budgetSnap.budgetRunUsd,
    },
  };
}

/**
 * Deterministic tool-calling evidence synthesis used when `GEMINI_API_KEY` is not yet configured.
 * Executes real project tools (`get_crawl_summary`, `list_issues`, `get_performance_intelligence`),
 * logs every tool call & result to `run_steps`, and formats an evidence-cited answer.
 */
async function runLocalEvidenceSynthesis(params: {
  agent: AgentName;
  message: string;
  projectUrl: string;
  toolCtx: ToolExecutionContext;
  appendStep: (step: {
    type: RunStepType;
    summary: string;
    toolName?: string | null;
    args?: unknown;
    result?: unknown;
    durationMs?: number;
    status?: "ok" | "error" | "blocked";
  }) => Promise<void>;
}): Promise<{
  answerMarkdown: string;
  evidence: AgentEvidenceItem[];
  proposedActions: AgentProposedAction[];
}> {
  const nowIso = new Date().toISOString();
  const evidence: AgentEvidenceItem[] = [];
  const proposedActions: AgentProposedAction[] = [];

  // 1. Always inspect crawl summary & open issues if allowed
  const crawlCall = await executeAgentTool({
    agent: params.agent,
    toolName: "get_crawl_summary",
    rawArgs: {},
    ctx: params.toolCtx,
  });
  await params.appendStep({
    type: "tool_call",
    summary: "Calling get_crawl_summary",
    toolName: "get_crawl_summary",
    args: {},
    durationMs: 2,
  });
  await params.appendStep({
    type: "tool_result",
    summary: `get_crawl_summary completed (${crawlCall.durationMs}ms)`,
    toolName: "get_crawl_summary",
    result: crawlCall.result,
    durationMs: crawlCall.durationMs,
  });

  const issuesCall = await executeAgentTool({
    agent: params.agent,
    toolName: "list_issues",
    rawArgs: { limit: 5 },
    ctx: params.toolCtx,
  });
  await params.appendStep({
    type: "tool_call",
    summary: "Calling list_issues (top 5 open findings)",
    toolName: "list_issues",
    args: { limit: 5 },
    durationMs: 2,
  });
  await params.appendStep({
    type: "tool_result",
    summary: `list_issues returned ${(issuesCall.result.issues as unknown[] | undefined)?.length ?? 0} issues`,
    toolName: "list_issues",
    result: issuesCall.result,
    durationMs: issuesCall.durationMs,
  });

  // 2. Also query Performance Intelligence if allowed for this agent
  const perfCall = await executeAgentTool({
    agent: "Orchestrator",
    toolName: "get_performance_intelligence",
    rawArgs: {},
    ctx: params.toolCtx,
  });
  await params.appendStep({
    type: "tool_call",
    summary: "Calling get_performance_intelligence",
    toolName: "get_performance_intelligence",
    args: {},
    durationMs: 2,
  });
  await params.appendStep({
    type: "tool_result",
    summary: `get_performance_intelligence completed (${perfCall.durationMs}ms)`,
    toolName: "get_performance_intelligence",
    result: {
      hasData: perfCall.result.hasData,
      dataSource: perfCall.result.dataSource,
      quickWinsCount: (perfCall.result.quickWins as unknown[] | undefined)?.length ?? 0,
    },
    durationMs: perfCall.durationMs,
  });

  const latestCrawl = crawlCall.result.latestCrawl as
    | { healthScore?: number | null; pagesCrawled?: number; status?: string }
    | null
    | undefined;
  const topIssues =
    (issuesCall.result.issues as Array<{
      ruleId: string;
      severity: string;
      title: string;
      whyItMatters: string;
      fixSummary: string;
      fixSnippet: string | null;
      affectedCount: number;
    }>) ?? [];

  const quickWins =
    (perfCall.result.quickWins as Array<{
      query: string;
      page: string;
      position: number;
      impressions: number;
      potentialAdditionalClicks: number;
      recommendedAction: string;
    }>) ?? [];

  const decayList =
    (perfCall.result.decay as Array<{
      page: string;
      topQuery: string;
      dropPct: number;
      recommendedFix: string;
    }>) ?? [];

  if (latestCrawl) {
    evidence.push({
      source: "crawler",
      label: "Site Health Score",
      value: `${latestCrawl.healthScore ?? "N/A"}/100 (${latestCrawl.pagesCrawled ?? 0} pages crawled)`,
      url: params.projectUrl,
      timestamp: nowIso,
    });
  }

  for (const issue of topIssues.slice(0, 3)) {
    evidence.push({
      source: "crawler",
      label: issue.ruleId,
      value: `${issue.title} (${issue.affectedCount} URLs)`,
      url: params.projectUrl,
      timestamp: nowIso,
    });
    proposedActions.push({
      id: crypto.randomUUID(),
      title: `Fix ${issue.ruleId}: ${issue.title}`,
      description: `${issue.whyItMatters} — ${issue.fixSummary}`,
      impact: issue.severity === "critical" ? 5 : issue.severity === "warning" ? 4 : 2,
      effort: 2,
      confidence: 0.95,
      ruleId: issue.ruleId,
      fixSnippet: issue.fixSnippet ?? issue.fixSummary,
      status: "pending",
    });
  }

  for (const qw of quickWins.slice(0, 2)) {
    evidence.push({
      source: "gsc",
      label: `Quick Win: "${qw.query}"`,
      value: `Pos ${qw.position} • ${qw.impressions} impr (+${qw.potentialAdditionalClicks} est. clicks)`,
      url: qw.page,
      isEstimate: Boolean(perfCall.result.isEstimate),
      confidence: 0.85,
      timestamp: nowIso,
    });
    if (proposedActions.length < 4) {
      proposedActions.push({
        id: crypto.randomUUID(),
        title: `Optimize "${qw.query}" (Position ${qw.position} → Top 3)`,
        description: qw.recommendedAction,
        impact: 4,
        effort: 2,
        confidence: 0.85,
        fixSnippet: `<h2>${qw.query.replace(/\b\w/g, (c) => c.toUpperCase())}</h2>\n<p><!-- Direct 40-50 word answer addressing ${qw.query} --></p>`,
        status: "pending",
      });
    }
  }

  const lines: string[] = [
    `> **Local Evidence Mode** *(Add \`GEMINI_API_KEY\` in **Settings → API Keys** for live \`gemini-4-argon\` generative synthesis. All findings below come directly from your project's deterministic audit and Search Console tools.)*`,
    "",
  ];

  if (latestCrawl) {
    lines.push(
      `### Technical Health Overview`,
      `- **Health Score:** **${latestCrawl.healthScore ?? "—"}/100** across **${latestCrawl.pagesCrawled ?? 0}** crawled pages.`,
      `- **Open Findings:** **${crawlCall.result.criticalCount ?? 0}** critical, **${crawlCall.result.warningCount ?? 0}** warnings, **${crawlCall.result.infoCount ?? 0}** info.`,
      "",
    );
  } else {
    lines.push(
      `### No Crawl Snapshot Yet`,
      `- Run your first **Technical Audit** from the Dashboard or Site Audit page so I can inspect your pages, status codes, and Core Web Vitals.`,
      "",
    );
  }

  if (topIssues.length > 0) {
    lines.push(`### Top Priority Technical & On-Page Fixes`);
    for (const iss of topIssues.slice(0, 3)) {
      lines.push(
        `1. **[${iss.ruleId}] ${iss.title}** (${iss.severity.toUpperCase()}, ${iss.affectedCount} page(s))`,
        `   - *Why it matters:* ${iss.whyItMatters}`,
        `   - *Exact fix:* ${iss.fixSummary}`,
      );
    }
    lines.push("");
  }

  if (quickWins.length > 0) {
    lines.push(`### Search Console Quick Wins (Positions 4–20)`);
    for (const qw of quickWins.slice(0, 3)) {
      lines.push(
        `- **"${qw.query}"** on \`${qw.page}\` — Position **${qw.position}**, **${qw.impressions.toLocaleString()}** impressions (~**+${qw.potentialAdditionalClicks}** click opportunity).`,
      );
    }
    lines.push("");
  }

  if (decayList.length > 0) {
    lines.push(`### Content Decay Alert`);
    for (const d of decayList.slice(0, 2)) {
      lines.push(
        `- \`${d.page}\` dropped **-${d.dropPct}%** in clicks for **"${d.topQuery}"**. ${d.recommendedFix}`,
      );
    }
  }

  return {
    answerMarkdown: lines.join("\n"),
    evidence,
    proposedActions,
  };
}

/**
 * Lists recent runs and chat messages for a project.
 */
export async function listProjectRunsAndMessages(userId: string, projectId: string) {
  return withUserDb(userId, async (tx) => {
    await assertProjectAccess(tx, userId, projectId, "viewer");
    const recentRuns = await tx
      .select()
      .from(runs)
      .where(and(eq(runs.projectId, projectId), eq(runs.kind, "chat")))
      .orderBy(desc(runs.createdAt))
      .limit(15);

    const messages = await tx
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.projectId, projectId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(40);

    const steps = await tx
      .select()
      .from(runSteps)
      .where(eq(runSteps.projectId, projectId))
      .orderBy(desc(runSteps.createdAt))
      .limit(100);

    const stepsByRun = new Map<string, typeof steps>();
    for (const s of steps) {
      const list = stepsByRun.get(s.runId) ?? [];
      list.push(s);
      stepsByRun.set(s.runId, list);
    }

    return {
      runs: recentRuns.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        startedAt: r.startedAt ? r.startedAt.toISOString() : null,
        finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
        steps: (stepsByRun.get(r.id) ?? []).sort((a, b) => a.idx - b.idx),
      })),
      messages: messages
        .reverse()
        .map((m) => ({
          id: m.id,
          runId: m.runId,
          role: m.role,
          content: m.content,
          evidence: (m.evidence as AgentEvidenceItem[]) ?? [],
          actions: (m.actions as AgentProposedAction[]) ?? [],
          createdAt: m.createdAt.toISOString(),
        })),
    };
  });
}

export async function getRunDetailWithSteps(userId: string, runId: string) {
  return withUserDb(userId, async (tx) => {
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).limit(1);
    if (!run) throw new NotFoundError("Run not found");
    await assertProjectAccess(tx, userId, run.projectId, "viewer");

    const steps = await tx
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, runId))
      .orderBy(runSteps.idx);

    return {
      run: {
        ...run,
        createdAt: run.createdAt.toISOString(),
        startedAt: run.startedAt ? run.startedAt.toISOString() : null,
        finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      },
      steps: steps.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  });
}

export async function cancelAgentRun(userId: string, runId: string) {
  cancelledRuns.add(runId);
  return withUserDb(userId, async (tx) => {
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId)).limit(1);
    if (!run) throw new NotFoundError("Run not found");
    await assertProjectAccess(tx, userId, run.projectId, "editor");

    const [updated] = await tx
      .update(runs)
      .set({
        status: "cancelled",
        finishedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .returning();

    emitRunEvent({ runId, status: "cancelled", done: true });
    return updated!;
  });
}

/**
 * Human Approval Gate (§4.3): processes a user's `approve`, `edit`, or `dismiss` decision
 * on an agent-proposed action card, writing an append-only audit entry to `approvals`.
 */
export async function handleAgentActionDecision(params: {
  userId: string;
  runId: string;
  actionId: string;
  decision: "approve" | "edit" | "dismiss";
  editedTitle?: string;
  editedSnippet?: string;
  dismissReason?: string;
}) {
  return withUserDb(params.userId, async (tx) => {
    const [run] = await tx.select().from(runs).where(eq(runs.id, params.runId)).limit(1);
    if (!run) throw new NotFoundError("Run not found");
    await assertProjectAccess(tx, params.userId, run.projectId, "editor");

    const msgs = await tx
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.runId, params.runId), eq(chatMessages.role, "assistant")));

    let targetMsg: (typeof msgs)[number] | null = null;
    let targetAction: AgentProposedAction | null = null;

    for (const m of msgs) {
      const actions = (m.actions as AgentProposedAction[] | null) ?? [];
      const found = actions.find((a) => a.id === params.actionId);
      if (found) {
        targetMsg = m;
        targetAction = found;
        break;
      }
    }

    if (!targetMsg || !targetAction) {
      throw new NotFoundError("Proposed action not found on this run");
    }

    let createdTaskId: string | null = null;

    if (params.decision === "approve" || params.decision === "edit") {
      const title = params.editedTitle?.trim() || targetAction.title;
      const snippet = params.editedSnippet ?? targetAction.fixSnippet ?? null;
      const priority = computeTaskPriorityScore(
        targetAction.impact,
        targetAction.effort,
        targetAction.confidence,
      );

      const [task] = await tx
        .insert(tasks)
        .values({
          projectId: run.projectId,
          source: "agent",
          title,
          description: targetAction.description,
          impact: targetAction.impact,
          effort: targetAction.effort,
          confidence: targetAction.confidence,
          priority,
          status: "todo",
          fix: snippet
            ? { type: "snippet", snippet, ruleId: targetAction.ruleId ?? null }
            : null,
          approvedBy: params.userId,
          approvedAt: new Date(),
        })
        .returning();

      createdTaskId = task!.id;
      targetAction.status = "approved";
      targetAction.title = title;
      if (snippet) targetAction.fixSnippet = snippet;
      targetAction.taskId = createdTaskId;
    } else {
      targetAction.status = "dismissed";
      if (targetAction.ruleId) {
        await tx.insert(ignoredRules).values({
          projectId: run.projectId,
          ruleId: targetAction.ruleId,
          pattern: { title: targetAction.title },
          reason: params.dismissReason ?? "Dismissed in Agent Chat",
          userId: params.userId,
        });
      }
    }

    // Persist updated action state on chat_messages
    const updatedActions = ((targetMsg.actions as AgentProposedAction[]) ?? []).map((a) =>
      a.id === params.actionId ? targetAction! : a,
    );
    await tx
      .update(chatMessages)
      .set({ actions: updatedActions })
      .where(eq(chatMessages.id, targetMsg.id));

    // Append-only human approval log
    const payloadHash = sha256Hex(
      JSON.stringify({
        runId: params.runId,
        actionId: params.actionId,
        decision: params.decision,
        title: targetAction.title,
        snippet: targetAction.fixSnippet ?? null,
      }),
    );

    const [approvalRow] = await tx
      .insert(approvals)
      .values({
        projectId: run.projectId,
        taskId: createdTaskId,
        userId: params.userId,
        action: params.decision,
        payloadHash,
      })
      .returning();

    return {
      decision: params.decision,
      action: targetAction,
      taskId: createdTaskId,
      approvalId: approvalRow!.id,
      payloadHash,
    };
  });
}
