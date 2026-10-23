import { desc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { withUserDb } from "@/lib/db/rls";
import { cwvResults, projects } from "@/lib/db/schema";
import { refreshProjectCwvViaCrux } from "@/lib/google/crux";
import { refreshProjectCwvViaPsi } from "@/lib/google/psi";
import { refreshCwvRequestSchema } from "@/lib/schemas/api/audit";
import { assertProjectRole, NotFoundError } from "@/lib/security/authz";
import { enforceRateLimit } from "@/lib/security/rate-limit";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    const { id } = await params;
    const rows = await withUserDb(user.id, async (tx) => {
      await assertProjectRole(tx, user.id, id, "viewer");
      return tx
        .select()
        .from(cwvResults)
        .where(eq(cwvResults.projectId, id))
        .orderBy(desc(cwvResults.fetchedAt))
        .limit(20);
    });
    return apiSuccess({ cwvResults: rows });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requireAuthUser();
    await enforceRateLimit("api_write", user.id);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = refreshCwvRequestSchema.parse(body);

    const project = await withUserDb(user.id, async (tx) => {
      await assertProjectRole(tx, user.id, id, "editor");
      const [p] = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, id))
        .limit(1);
      if (!p) throw new NotFoundError("Project not found");
      return p;
    });

    const targetUrl = parsed.url ?? project.url;
    const saved = [];
    const errors: string[] = [];

    if (parsed.source === "psi" || parsed.source === "both") {
      const psiRes = await refreshProjectCwvViaPsi({
        userId: user.id,
        projectId: id,
        url: targetUrl,
      });
      saved.push(...psiRes.saved);
      errors.push(...psiRes.errors);
    }

    if (parsed.source === "crux" || parsed.source === "both") {
      const cruxRes = await refreshProjectCwvViaCrux({
        userId: user.id,
        projectId: id,
        url: targetUrl,
      });
      saved.push(...cruxRes.saved);
      errors.push(...cruxRes.errors);
    }

    return apiSuccess({
      url: targetUrl,
      saved,
      errors,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
