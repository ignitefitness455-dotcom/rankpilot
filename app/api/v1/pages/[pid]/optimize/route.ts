import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { withUserDb } from "@/lib/db/rls";
import { pages } from "@/lib/db/schema";
import { optimizePageById } from "@/lib/onpage/optimizer";
import { postPageOptimizeSchema } from "@/lib/schemas/api/research";
import { NotFoundError } from "@/lib/security/authz";

export async function POST(
  req: Request,
  context: { params: Promise<{ pid: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { pid: pageId } = await context.params;

    const projectId = await withUserDb(user.id, async (tx) => {
      const [row] = await tx
        .select({ projectId: pages.projectId })
        .from(pages)
        .where(eq(pages.id, pageId))
        .limit(1);
      return row?.projectId ?? null;
    });

    if (!projectId) {
      throw new NotFoundError("Crawled page not found");
    }

    const body = postPageOptimizeSchema.parse(await req.json().catch(() => ({})));
    const report = await optimizePageById({
      userId: user.id,
      projectId,
      pageId,
      targetKeyword: body.targetKeyword,
    });

    return apiSuccess({ report });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
