import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  competitors,
  projectMembers,
  projectProfiles,
  projects,
  users,
  type ProfileFields,
  type ProjectRole,
} from "@/lib/db/schema";
import { withUserDb, type RlsTx } from "@/lib/db/rls";
import { assertProjectAccess, listAccessibleProjects, NotFoundError } from "@/lib/security/authz";
import { getEnv } from "@/lib/security/env";
import { DEFAULT_PROFILE_FIELDS, serializeProjectProfile } from "./profile";
import type { z } from "zod";
import type {
  createProjectSchema,
  profileFieldsSchema,
  updateProjectSchema,
} from "@/lib/schemas/api/projects";

export function normalizeUrlAndHost(rawUrl: string): { url: string; host: string } {
  const parsed = new URL(rawUrl);
  parsed.hash = "";
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const cleanUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  return { url: cleanUrl, host };
}

export async function createProjectForUser(
  userId: string,
  input: z.infer<typeof createProjectSchema>,
) {
  const env = getEnv();
  const { url, host } = normalizeUrlAndHost(input.url);
  const verifyToken = `rp_${randomBytes(16).toString("hex")}`;

  const fields: ProfileFields = {
    ...DEFAULT_PROFILE_FIELDS,
    ...input.profile,
    languages: input.profile?.languages ?? [input.language ?? "en"],
  };

  return withUserDb(userId, async (tx) => {
    const [created] = await tx
      .insert(projects)
      .values({
        ownerId: userId,
        name: input.name,
        url,
        host,
        verifyToken,
        cms: input.cms ?? null,
        language: input.language ?? "en",
        settings: {
          crawl: {
            maxPages: env.CRAWLER_MAX_PAGES_DEFAULT,
            maxDepth: env.CRAWLER_MAX_DEPTH_DEFAULT,
            render: env.CRAWLER_ENABLE_RENDER,
            rps: env.CRAWLER_RPS,
          },
        },
      })
      .returning();

    if (!created) {
      throw new Error("Failed to insert project");
    }

    await tx.insert(projectMembers).values({
      projectId: created.id,
      userId,
      role: "owner",
    });

    const profileText = serializeProjectProfile({
      projectId: created.id,
      name: created.name,
      url: created.url,
      host: created.host,
      cms: created.cms,
      language: created.language,
      version: 1,
      fields,
    });

    const [profile] = await tx
      .insert(projectProfiles)
      .values({
        projectId: created.id,
        version: 1,
        fields,
        profileText,
      })
      .returning();

    if (fields.competitorHosts.length > 0) {
      for (const compHost of fields.competitorHosts) {
        await tx
          .insert(competitors)
          .values({
            projectId: created.id,
            host: compHost,
            name: compHost,
            autoDiscovered: false,
          })
          .onConflictDoNothing();
      }
    }

    return { project: created, profile: profile! };
  });
}

export async function getUserProjects(userId: string) {
  return withUserDb(userId, (tx) => listAccessibleProjects(tx, userId));
}

export async function getProjectDetail(userId: string, projectId: string) {
  return withUserDb(userId, async (tx) => {
    const { project, role } = await assertProjectAccess(tx, userId, projectId, "viewer");
    const [profile] = await tx
      .select()
      .from(projectProfiles)
      .where(eq(projectProfiles.projectId, projectId))
      .limit(1);

    return { project, role, profile: profile ?? null };
  });
}

export async function updateProjectById(
  userId: string,
  projectId: string,
  patch: z.infer<typeof updateProjectSchema>,
) {
  return withUserDb(userId, async (tx) => {
    const { project } = await assertProjectAccess(tx, userId, projectId, "editor");

    const nextSettings = {
      ...project.settings,
      ...(patch.settings?.crawl
        ? { crawl: { ...project.settings.crawl, ...patch.settings.crawl } }
        : {}),
      ...(patch.settings?.budgetProjectDayUsd !== undefined
        ? { budgetProjectDayUsd: patch.settings.budgetProjectDayUsd }
        : {}),
    };

    const [updated] = await tx
      .update(projects)
      .set({
        name: patch.name ?? project.name,
        cms: patch.cms !== undefined ? patch.cms : project.cms,
        language: patch.language !== undefined ? patch.language : project.language,
        settings: nextSettings,
      })
      .where(eq(projects.id, projectId))
      .returning();

    // Keep project profile serialized text in sync if name/cms/language changed
    const [existingProfile] = await tx
      .select()
      .from(projectProfiles)
      .where(eq(projectProfiles.projectId, projectId))
      .limit(1);

    if (existingProfile && updated) {
      const nextVersion = existingProfile.version + 1;
      const profileText = serializeProjectProfile({
        projectId: updated.id,
        name: updated.name,
        url: updated.url,
        host: updated.host,
        cms: updated.cms,
        language: updated.language,
        version: nextVersion,
        fields: existingProfile.fields,
      });
      await tx
        .update(projectProfiles)
        .set({ version: nextVersion, profileText })
        .where(eq(projectProfiles.projectId, projectId));
    }

    return updated!;
  });
}

export async function updateProjectProfile(
  userId: string,
  projectId: string,
  fieldsInput: z.infer<typeof profileFieldsSchema>,
) {
  return withUserDb(userId, async (tx) => {
    const { project } = await assertProjectAccess(tx, userId, projectId, "editor");
    const [existing] = await tx
      .select()
      .from(projectProfiles)
      .where(eq(projectProfiles.projectId, projectId))
      .limit(1);

    const nextVersion = (existing?.version ?? 0) + 1;
    const profileText = serializeProjectProfile({
      projectId: project.id,
      name: project.name,
      url: project.url,
      host: project.host,
      cms: project.cms,
      language: project.language,
      version: nextVersion,
      fields: fieldsInput,
    });

    if (existing) {
      const [updated] = await tx
        .update(projectProfiles)
        .set({
          version: nextVersion,
          fields: fieldsInput,
          profileText,
        })
        .where(eq(projectProfiles.projectId, projectId))
        .returning();
      return updated!;
    } else {
      const [inserted] = await tx
        .insert(projectProfiles)
        .values({
          projectId,
          version: nextVersion,
          fields: fieldsInput,
          profileText,
        })
        .returning();
      return inserted!;
    }
  });
}

export async function softDeleteProject(userId: string, projectId: string) {
  return withUserDb(userId, async (tx) => {
    await assertProjectAccess(tx, userId, projectId, "owner");
    await tx
      .update(projects)
      .set({ deletedAt: new Date() })
      .where(eq(projects.id, projectId));
    return { deleted: true };
  });
}

export async function listProjectMembers(
  tx: RlsTx,
  userId: string,
  projectId: string,
): Promise<
  Array<{
    userId: string;
    email: string | null;
    name: string | null;
    role: ProjectRole;
  }>
> {
  await assertProjectAccess(tx, userId, projectId, "viewer");
  const rows = await tx
    .select({
      userId: projectMembers.userId,
      role: projectMembers.role,
      email: users.email,
      name: users.name,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId));
  return rows;
}

export async function addProjectMemberByEmail(
  userId: string,
  projectId: string,
  email: string,
  role: "editor" | "viewer",
) {
  return withUserDb(userId, async (tx) => {
    await assertProjectAccess(tx, userId, projectId, "owner");
    const [targetUser] = await tx
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()))
      .limit(1);
    if (!targetUser) {
      throw new NotFoundError(`No user found with email ${email}`);
    }
    await tx
      .insert(projectMembers)
      .values({
        projectId,
        userId: targetUser.id,
        role,
      })
      .onConflictDoUpdate({
        target: [projectMembers.projectId, projectMembers.userId],
        set: { role },
      });
    return { userId: targetUser.id, email: targetUser.email, role };
  });
}

export async function removeProjectMember(
  userId: string,
  projectId: string,
  targetUserId: string,
) {
  return withUserDb(userId, async (tx) => {
    const { project } = await assertProjectAccess(tx, userId, projectId, "owner");
    if (targetUserId === project.ownerId) {
      throw new Error("Cannot remove the project owner");
    }
    await tx
      .delete(projectMembers)
      .where(
        and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, targetUserId)),
      );
    return { removed: true };
  });
}
