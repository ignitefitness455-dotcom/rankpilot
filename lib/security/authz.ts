import { and, eq, isNull, or } from "drizzle-orm";
import { projectMembers, projects, type ProjectRole } from "@/lib/db/schema";
import type { RlsTx } from "@/lib/db/rls";

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "You do not have permission to access this project") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message = "Resource not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

const ROLE_WEIGHT: Record<ProjectRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

export function hasMinimumRole(actual: ProjectRole, minimum: ProjectRole): boolean {
  return ROLE_WEIGHT[actual] >= ROLE_WEIGHT[minimum];
}

export interface ProjectAccessContext {
  project: typeof projects.$inferSelect;
  role: ProjectRole;
}

/**
 * Primary application-layer authorization check (paired with Postgres RLS defense-in-depth).
 * Verifies the user belongs to the project (or owns it) and meets `minRole`.
 */
export async function assertProjectAccess(
  tx: RlsTx,
  userId: string,
  projectId: string,
  minRole: ProjectRole = "viewer",
): Promise<ProjectAccessContext> {
  const [project] = await tx
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);

  if (!project) {
    throw new NotFoundError("Project not found");
  }

  let role: ProjectRole | null = null;
  if (project.ownerId === userId) {
    role = "owner";
  } else {
    const [member] = await tx
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (member) {
      role = member.role;
    }
  }

  if (!role || !hasMinimumRole(role, minRole)) {
    throw new ForbiddenError(`Requires '${minRole}' access to this project`);
  }

  return { project, role };
}

export const assertProjectRole = assertProjectAccess;

/**
 * Lists all active projects accessible to `userId` (either as owner or member).
 */
export async function listAccessibleProjects(
  tx: RlsTx,
  userId: string,
): Promise<Array<{ project: typeof projects.$inferSelect; role: ProjectRole }>> {
  const rows = await tx
    .select({
      project: projects,
      memberRole: projectMembers.role,
    })
    .from(projects)
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)),
    )
    .where(
      and(
        isNull(projects.deletedAt),
        or(eq(projects.ownerId, userId), eq(projectMembers.userId, userId)),
      ),
    );

  return rows.map((r) => ({
    project: r.project,
    role: r.project.ownerId === userId ? "owner" : (r.memberRole ?? "viewer"),
  }));
}
