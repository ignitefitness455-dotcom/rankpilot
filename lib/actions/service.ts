import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { computeTaskPriorityScore } from "@/lib/ai/tools";
import { withUserDb } from "@/lib/db/rls";
import {
  approvals,
  ignoredRules,
  issues,
  tasks,
  type TaskStatus,
} from "@/lib/db/schema";
import { assertProjectAccess, NotFoundError } from "@/lib/security/authz";

export interface TaskFixPayload {
  type?: string;
  snippet?: string | null;
  ruleId?: string | null;
  steps?: string[];
  affectedUrls?: string[];
}

export interface TaskItemDto {
  id: string;
  projectId: string;
  issueId: string | null;
  source: "audit" | "onpage" | "geo" | "perf" | "agent" | "manual";
  title: string;
  description: string | null;
  impact: number;
  effort: number;
  confidence: number;
  priority: number;
  status: TaskStatus;
  position: number;
  fix: TaskFixPayload | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalLogDto {
  id: string;
  taskId: string | null;
  contentItemId: string | null;
  userId: string;
  action: "approve" | "edit" | "dismiss" | "export";
  payloadHash: string;
  at: string;
}

export interface IgnoredRuleDto {
  id: string;
  ruleId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface ActionCenterOverview {
  tasks: TaskItemDto[];
  approvals: ApprovalLogDto[];
  ignoredRules: IgnoredRuleDto[];
}

export function computeApprovalPayloadHash(payload: unknown): string {
  const serialized = JSON.stringify(payload ?? {});
  return createHash("sha256").update(serialized).digest("hex");
}

function mapTaskRow(row: typeof tasks.$inferSelect): TaskItemDto {
  const rawFix =
    typeof row.fix === "object" && row.fix !== null
      ? (row.fix as TaskFixPayload)
      : null;

  return {
    id: row.id,
    projectId: row.projectId,
    issueId: row.issueId,
    source: row.source,
    title: row.title,
    description: row.description,
    impact: row.impact,
    effort: row.effort,
    confidence: row.confidence,
    priority: row.priority,
    status: row.status,
    position: row.position,
    fix: rawFix,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Syncs open audit issues (`issues`) into the Action Center (`tasks`) if not already present,
 * skipping any rule IDs listed in `ignored_rules`.
 */
export async function syncAuditIssuesToTasks(
  userId: string,
  projectId: string,
): Promise<number> {
  return withUserDb(userId, async (tx) => {
    await assertProjectAccess(tx, userId, projectId, "editor");

    const openIssues = await tx
      .select()
      .from(issues)
      .where(and(eq(issues.projectId, projectId), eq(issues.status, "open")))
      .orderBy(desc(issues.affectedCount))
      .limit(40);

    const existingTasks = await tx
      .select({ issueId: tasks.issueId, fix: tasks.fix })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)));

    const existingIssueIds = new Set(
      existingTasks.map((t) => t.issueId).filter(Boolean),
    );

    const ignoredRows = await tx
      .select({ ruleId: ignoredRules.ruleId })
      .from(ignoredRules)
      .where(eq(ignoredRules.projectId, projectId));
    const ignoredRuleIds = new Set(
      ignoredRows.map((r) => r.ruleId).filter(Boolean),
    );

    let createdCount = 0;
    for (const iss of openIssues) {
      if (existingIssueIds.has(iss.id) || ignoredRuleIds.has(iss.ruleId)) {
        continue;
      }

      const priority = computeTaskPriorityScore(
        iss.finding.impact,
        iss.finding.effort,
        iss.finding.confidence,
      );

      await tx.insert(tasks).values({
        projectId,
        issueId: iss.id,
        source: "audit",
        title: iss.finding.title,
        description: `${iss.finding.why_it_matters}\n\nSteps: ${iss.finding.fix.steps.join(" ")}`,
        impact: iss.finding.impact,
        effort: iss.finding.effort,
        confidence: iss.finding.confidence,
        priority,
        status: "todo",
        fix: {
          type: "audit_fix",
          ruleId: iss.ruleId,
          snippet: iss.finding.fix.code_snippet ?? null,
          steps: iss.finding.fix.steps,
          affectedUrls: iss.finding.evidence.slice(0, 5).map((e) => e.url),
        },
      });
      createdCount += 1;
    }

    return createdCount;
  });
}

export async function listProjectActionCenter(
  userId: string,
  projectId: string,
): Promise<ActionCenterOverview> {
  return withUserDb(userId, async (tx) => {
    await assertProjectAccess(tx, userId, projectId, "viewer");

    const taskRows = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
      .orderBy(desc(tasks.priority), desc(tasks.createdAt));

    const approvalRows = await tx
      .select()
      .from(approvals)
      .where(eq(approvals.projectId, projectId))
      .orderBy(desc(approvals.at))
      .limit(50);

    const ignoredRows = await tx
      .select()
      .from(ignoredRules)
      .where(eq(ignoredRules.projectId, projectId))
      .orderBy(desc(ignoredRules.createdAt));

    return {
      tasks: taskRows.map(mapTaskRow),
      approvals: approvalRows.map((a) => ({
        id: a.id,
        taskId: a.taskId,
        contentItemId: a.contentItemId,
        userId: a.userId,
        action: a.action,
        payloadHash: a.payloadHash,
        at: a.at.toISOString(),
      })),
      ignoredRules: ignoredRows.map((r) => ({
        id: r.id,
        ruleId: r.ruleId,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });
}

export async function createProjectTask(params: {
  userId: string;
  projectId: string;
  source?: "audit" | "onpage" | "geo" | "perf" | "agent" | "manual";
  title: string;
  description?: string;
  impact: number;
  effort: number;
  confidence: number;
  ruleId?: string;
  fixSnippet?: string;
}): Promise<TaskItemDto> {
  return withUserDb(params.userId, async (tx) => {
    await assertProjectAccess(tx, params.userId, params.projectId, "editor");

    const priority = computeTaskPriorityScore(
      params.impact,
      params.effort,
      params.confidence,
    );

    const [inserted] = await tx
      .insert(tasks)
      .values({
        projectId: params.projectId,
        source: params.source ?? "manual",
        title: params.title.trim(),
        description: params.description?.trim() || null,
        impact: params.impact,
        effort: params.effort,
        confidence: params.confidence,
        priority,
        status: "todo",
        fix:
          params.fixSnippet || params.ruleId
            ? {
                type: "manual_snippet",
                ruleId: params.ruleId ?? null,
                snippet: params.fixSnippet ?? null,
              }
            : null,
      })
      .returning();

    return mapTaskRow(inserted!);
  });
}

/**
 * Applies a human decision (`approve`, `edit`, `dismiss`) or Kanban status transition
 * to a task, writing an immutable SHA-256 record to `approvals` and updating `ignored_rules` on dismiss.
 */
export async function updateTaskWithApprovalGate(params: {
  userId: string;
  taskId: string;
  status?: TaskStatus;
  decision?: "approve" | "edit" | "dismiss";
  editedTitle?: string;
  editedDescription?: string;
  editedSnippet?: string;
  dismissReason?: string;
}): Promise<TaskItemDto> {
  return withUserDb(params.userId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, params.taskId), isNull(tasks.deletedAt)))
      .limit(1);

    if (!existing) {
      throw new NotFoundError("Task not found");
    }

    await assertProjectAccess(tx, params.userId, existing.projectId, "editor");

    const currentFix: TaskFixPayload =
      typeof existing.fix === "object" && existing.fix !== null
        ? (existing.fix as TaskFixPayload)
        : {};

    const nextTitle = params.editedTitle?.trim() || existing.title;
    const nextDesc =
      params.editedDescription !== undefined
        ? params.editedDescription
        : existing.description;
    const nextFix: TaskFixPayload =
      params.editedSnippet !== undefined
        ? { ...currentFix, snippet: params.editedSnippet }
        : currentFix;

    let nextStatus: TaskStatus = params.status ?? existing.status;
    let approvedBy = existing.approvedBy;
    let approvedAt = existing.approvedAt;

    if (params.decision === "approve" || params.decision === "edit") {
      approvedBy = params.userId;
      approvedAt = new Date();
      if (nextStatus === "todo") {
        nextStatus = "in_progress";
      }
    } else if (params.decision === "dismiss") {
      nextStatus = "ignored";
    }

    const [updated] = await tx
      .update(tasks)
      .set({
        title: nextTitle,
        description: nextDesc,
        fix: nextFix,
        status: nextStatus,
        approvedBy,
        approvedAt,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, existing.id))
      .returning();

    if (params.decision) {
      const payloadHash = computeApprovalPayloadHash({
        taskId: existing.id,
        decision: params.decision,
        title: nextTitle,
        fix: nextFix,
      });

      await tx.insert(approvals).values({
        projectId: existing.projectId,
        taskId: existing.id,
        userId: params.userId,
        action: params.decision,
        payloadHash,
      });

      if (params.decision === "dismiss" && currentFix.ruleId) {
        await tx.insert(ignoredRules).values({
          projectId: existing.projectId,
          ruleId: currentFix.ruleId,
          pattern: { taskId: existing.id },
          reason: params.dismissReason?.trim() || "Dismissed in Action Center",
          userId: params.userId,
        });
      }
    }

    return mapTaskRow(updated!);
  });
}

/**
 * Formats tasks into a downloadable bundle (`markdown`, `json`, `csv`, or `git_patch`)
 * and logs an `"export"` entry in the append-only `approvals` audit table.
 */
export function formatTasksExportBundle(
  items: TaskItemDto[],
  format: "markdown" | "json" | "csv" | "git_patch",
): { filename: string; contentType: string; content: string } {
  switch (format) {
    case "json":
      return {
        filename: "rankpilot-approved-fixes.json",
        contentType: "application/json",
        content: JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            count: items.length,
            tasks: items,
          },
          null,
          2,
        ),
      };

    case "csv": {
      const header = "id,priority,status,source,impact,effort,confidence,title,approvedAt";
      const rows = items.map((t) =>
        [
          t.id,
          t.priority,
          t.status,
          t.source,
          t.impact,
          t.effort,
          t.confidence,
          `"${t.title.replace(/"/g, '""')}"`,
          t.approvedAt ?? "",
        ].join(","),
      );
      return {
        filename: "rankpilot-approved-fixes.csv",
        contentType: "text/csv",
        content: [header, ...rows].join("\n"),
      };
    }

    case "git_patch": {
      const patchBlocks = items.map((t, idx) => {
        const snippet =
          t.fix?.snippet ??
          `<!-- Fix for: ${t.title} (Priority ${t.priority}) -->`;
        const plusLines = snippet
          .split("\n")
          .map((line) => `+${line}`)
          .join("\n");
        return [
          `diff --git a/seo-fixes/fix-${idx + 1}-${t.fix?.ruleId ?? t.source}.html b/seo-fixes/fix-${idx + 1}-${t.fix?.ruleId ?? t.source}.html`,
          `new file mode 100644`,
          `--- /dev/null`,
          `+++ b/seo-fixes/fix-${idx + 1}-${t.fix?.ruleId ?? t.source}.html`,
          `@@ -0,0 +1,${snippet.split("\n").length + 2} @@`,
          `+<!-- RankPilot Approved Fix: ${t.title} (Priority: ${t.priority}/100) -->`,
          plusLines,
          `+<!-- End Fix -->`,
        ].join("\n");
      });
      return {
        filename: "rankpilot-seo-fixes.patch",
        contentType: "text/x-diff",
        content:
          patchBlocks.join("\n\n") ||
          "# No approved tasks with code snippets selected.",
      };
    }

    case "markdown":
    default: {
      const mdSections = items.map(
        (t, idx) =>
          `## ${idx + 1}. [P${t.priority}] ${t.title}\n\n` +
          `- **Status:** \`${t.status}\` | **Source:** \`${t.source}\` | **Impact:** ${t.impact}/5 | **Effort:** ${t.effort}/5 | **Confidence:** ${Math.round(t.confidence * 100)}%\n` +
          `- **Approved At:** ${t.approvedAt ?? "Pending approval"}\n\n` +
          `${t.description ?? ""}\n\n` +
          (t.fix?.snippet
            ? `### Copy-Paste Fix Snippet\n\n\`\`\`html\n${t.fix.snippet}\n\`\`\`\n`
            : ""),
      );
      return {
        filename: "rankpilot-action-plan.md",
        contentType: "text/markdown",
        content: `# RankPilot Approved SEO Action Plan\n\nGenerated: ${new Date().toISOString()}\n\n${mdSections.join("\n---\n\n")}`,
      };
    }
  }
}

export async function exportProjectTasks(params: {
  userId: string;
  projectId: string;
  format: "markdown" | "json" | "csv" | "git_patch";
  onlyApproved?: boolean;
}): Promise<{ filename: string; contentType: string; content: string; count: number }> {
  // Exporting is an approval-gate event (logged to `approvals`), so it requires editor access.
  // Checking up front returns a clean 403 instead of a raw RLS write failure for viewers.
  await withUserDb(params.userId, (tx) =>
    assertProjectAccess(tx, params.userId, params.projectId, "editor"),
  );

  const overview = await listProjectActionCenter(params.userId, params.projectId);
  const filtered = overview.tasks.filter((t) => {
    if (t.status === "ignored") return false;
    if (params.onlyApproved) return Boolean(t.approvedAt);
    return true;
  });

  const bundle = formatTasksExportBundle(filtered, params.format);

  await withUserDb(params.userId, async (tx) => {
    await tx.insert(approvals).values({
      projectId: params.projectId,
      taskId: filtered[0]?.id ?? null,
      userId: params.userId,
      action: "export",
      payloadHash: computeApprovalPayloadHash({
        format: params.format,
        count: filtered.length,
      }),
    });
  });

  return {
    ...bundle,
    count: filtered.length,
  };
}
