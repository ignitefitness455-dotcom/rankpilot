import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ensureEmbeddedPostgresRunning, applyMigrationsAndRls } from "@/scripts/setup";
import {
  createProjectTask,
  exportProjectTasks,
  listProjectActionCenter,
  updateTaskWithApprovalGate,
} from "@/lib/actions/service";
import { listProjectCompetitors } from "@/lib/competitors/service";
import { listProjectContentItems } from "@/lib/content/studio";
import { closeAllPools, getAdminDb } from "@/lib/db/client";
import { withUserDb } from "@/lib/db/rls";
import { alerts, integrations, projects, tasks, users } from "@/lib/db/schema";
import { addTrackedPrompt, getProjectGeoOverview } from "@/lib/geo/service";
import { listProjectKeywords } from "@/lib/keywords/service";
import {
  addProjectMemberByEmail,
  createProjectForUser,
  getProjectDetail,
  updateProjectById,
} from "@/lib/projects/service";
import {
  generateProjectReport,
  listProjectReportsAndAlerts,
  markProjectAlertRead,
} from "@/lib/reports/service";
import { resolveDecryptedSecret, upsertUserApiKey } from "@/lib/settings/service";

describe("Postgres RLS & Project Authorization (integration)", () => {
  let stopPg: (() => Promise<void>) | null = null;
  const userA = { id: "aaaa0000-0000-4000-8000-000000000001", email: "alice@test.local" };
  const userB = { id: "bbbb0000-0000-4000-8000-000000000002", email: "bob@test.local" };
  let projectAId = "";
  let taskAId = "";

  beforeAll(async () => {
    stopPg = await ensureEmbeddedPostgresRunning();
    await applyMigrationsAndRls();

    const adminDb = getAdminDb();
    await adminDb
      .insert(users)
      .values([
        { id: userA.id, email: userA.email, name: "Alice" },
        { id: userB.id, email: userB.email, name: "Bob" },
      ])
      .onConflictDoNothing();

    const existing = await adminDb
      .select()
      .from(projects)
      .where(eq(projects.ownerId, userA.id));
    if (existing.length > 0) {
      await adminDb.delete(projects).where(eq(projects.ownerId, userA.id));
    }

    const created = await createProjectForUser(userA.id, {
      name: "Alice Site",
      url: "https://alice-seo-test.example.com",
      language: "en",
    });
    projectAId = created.project.id;
  });

  afterAll(async () => {
    await closeAllPools();
    if (stopPg) await stopPg();
  });

  it("blocks User B from reading User A's project at both RLS and service layers", async () => {
    // Direct table SELECT inside User B's RLS transaction returns 0 rows
    const rowsForB = await withUserDb(userB.id, (tx) =>
      tx.select().from(projects).where(eq(projects.id, projectAId)),
    );
    expect(rowsForB).toHaveLength(0);

    await expect(getProjectDetail(userB.id, projectAId)).rejects.toThrow(/Project not found/);
  });

  it("isolates encrypted BYOK keys per user via RLS", async () => {
    await upsertUserApiKey(userA.id, "gemini_key", "AIzaSyAlicePrivateKey1234");

    const bRows = await withUserDb(userB.id, (tx) => tx.select().from(integrations));
    expect(bRows).toHaveLength(0);

    const decryptedForA = await resolveDecryptedSecret(userA.id, "gemini_key");
    expect(decryptedForA?.secret).toBe("AIzaSyAlicePrivateKey1234");
    expect(decryptedForA?.source).toBe("byok");
  });

  it("blocks a non-member from every Phase 4/5 module service (IDOR matrix)", async () => {
    // Owner A creates module data
    const task = await createProjectTask({
      userId: userA.id,
      projectId: projectAId,
      title: "Add canonical to /pricing",
      impact: 4,
      effort: 1,
      confidence: 1,
      fixSnippet: '<link rel="canonical" href="https://alice-seo-test.example.com/pricing" />',
    });
    taskAId = task.id;
    await addTrackedPrompt({ userId: userA.id, projectId: projectAId, prompt: "best seo tool" });
    await generateProjectReport({ userId: userA.id, projectId: projectAId, period: "weekly", locale: "en" });

    const notFound = /Project not found/;
    await expect(listProjectKeywords(userB.id, projectAId)).rejects.toThrow(notFound);
    await expect(listProjectCompetitors(userB.id, projectAId)).rejects.toThrow(notFound);
    await expect(listProjectContentItems(userB.id, projectAId)).rejects.toThrow(notFound);
    await expect(getProjectGeoOverview(userB.id, projectAId)).rejects.toThrow(notFound);
    await expect(listProjectActionCenter(userB.id, projectAId)).rejects.toThrow(notFound);
    await expect(listProjectReportsAndAlerts(userB.id, projectAId)).rejects.toThrow(notFound);
    await expect(
      exportProjectTasks({ userId: userB.id, projectId: projectAId, format: "json" }),
    ).rejects.toThrow(notFound);

    // Object-ID routes (no projectId in URL) must not leak existence across tenants
    await expect(
      updateTaskWithApprovalGate({ userId: userB.id, taskId: taskAId, decision: "approve" }),
    ).rejects.toThrow(/Task not found/);

    const [alertRow] = await getAdminDb()
      .select({ id: alerts.id })
      .from(alerts)
      .where(eq(alerts.projectId, projectAId))
      .limit(1);
    await expect(
      markProjectAlertRead({ userId: userB.id, alertId: alertRow!.id }),
    ).rejects.toThrow(/Alert not found/);

    // Task stays unapproved after the blocked attempt
    const [taskRow] = await getAdminDb().select().from(tasks).where(eq(tasks.id, taskAId));
    expect(taskRow?.approvedAt).toBeNull();
  });

  it("allows viewer read access when invited, but blocks editor/owner mutations", async () => {
    await addProjectMemberByEmail(userA.id, projectAId, userB.email, "viewer");

    const detailForB = await getProjectDetail(userB.id, projectAId);
    expect(detailForB.role).toBe("viewer");
    expect(detailForB.project.host).toBe("alice-seo-test.example.com");

    await expect(
      updateProjectById(userB.id, projectAId, { name: "Hijacked Name" }),
    ).rejects.toThrow(/Requires 'editor' access/);
  });

  it("lets a viewer read Phase 5 modules but blocks approvals and exports", async () => {
    // B is a viewer from the previous test
    const overview = await listProjectActionCenter(userB.id, projectAId);
    expect(overview.tasks.some((t) => t.id === taskAId)).toBe(true);

    await expect(
      updateTaskWithApprovalGate({ userId: userB.id, taskId: taskAId, decision: "approve" }),
    ).rejects.toThrow(/Requires 'editor' access/);
    await expect(
      exportProjectTasks({ userId: userB.id, projectId: projectAId, format: "markdown" }),
    ).rejects.toThrow(/Requires 'editor' access/);

    // Owner can approve; the decision lands in the append-only approvals log
    const approved = await updateTaskWithApprovalGate({
      userId: userA.id,
      taskId: taskAId,
      decision: "approve",
    });
    expect(approved.approvedBy).toBe(userA.id);
    const afterApprove = await listProjectActionCenter(userA.id, projectAId);
    expect(afterApprove.approvals.some((a) => a.taskId === taskAId && a.action === "approve")).toBe(true);
  });
});
