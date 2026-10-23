import type { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuthUser } from "@/lib/auth";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { withUserDb } from "@/lib/db/rls";
import { alerts } from "@/lib/db/schema";

export async function GET() {
  try {
    const user = await requireAuthUser();
    const list = await withUserDb(user.id, (tx) =>
      tx.select().from(alerts).orderBy(desc(alerts.createdAt)).limit(30),
    );
    return apiSuccess(list);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuthUser();
    const { id } = z.object({ id: z.uuid() }).parse(await req.json());
    const updated = await withUserDb(user.id, async (tx) => {
      const [row] = await tx
        .update(alerts)
        .set({ readAt: new Date() })
        .where(eq(alerts.id, id))
        .returning();
      return row ?? null;
    });
    return apiSuccess(updated);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
