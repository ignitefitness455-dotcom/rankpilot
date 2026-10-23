import {
  type AuditRuleContext,
  type EvaluatedRuleFinding,
  evaluateAllAuditRules,
} from "@/lib/audit/rules";
import { type AuditScoreBreakdown, computeAuditScore } from "@/lib/audit/score";
import { type Finding, findingSchema } from "@/lib/schemas/finding";

export interface AuditEngineResult {
  findings: Finding[];
  evaluated: EvaluatedRuleFinding[];
  score: AuditScoreBreakdown;
}

/**
 * Executes the deterministic audit rule engine on a crawl context, validates every finding
 * against `findingSchema` (Zod), and computes the 0-100 health score & category breakdown.
 */
export function runDeterministicAuditEngine(ctx: AuditRuleContext): AuditEngineResult {
  const rawEvaluated = evaluateAllAuditRules(ctx);
  const validatedEvaluated: EvaluatedRuleFinding[] = [];
  const findings: Finding[] = [];

  for (const item of rawEvaluated) {
    const parsed = findingSchema.parse(item.finding);
    validatedEvaluated.push({
      finding: parsed,
      pageEvidenceMap: item.pageEvidenceMap,
    });
    findings.push(parsed);
  }

  // Sort findings by priority: impact * confidence / effort descending, then severity
  const severityWeight: Record<Finding["severity"], number> = {
    critical: 3,
    warning: 2,
    info: 1,
  };

  validatedEvaluated.sort((a, b) => {
    const sevDiff =
      severityWeight[b.finding.severity] - severityWeight[a.finding.severity];
    if (sevDiff !== 0) return sevDiff;
    const scoreA = (a.finding.impact * a.finding.confidence) / Math.max(1, a.finding.effort);
    const scoreB = (b.finding.impact * b.finding.confidence) / Math.max(1, b.finding.effort);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.finding.id.localeCompare(b.finding.id);
  });

  const sortedFindings = validatedEvaluated.map((e) => e.finding);
  const score = computeAuditScore(sortedFindings, ctx.pages.length);

  return {
    findings: sortedFindings,
    evaluated: validatedEvaluated,
    score,
  };
}
