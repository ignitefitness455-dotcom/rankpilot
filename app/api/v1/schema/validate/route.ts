import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { validateSchemaJsonLd } from "@/lib/schema-gen/generator";
import { postSchemaValidateSchema } from "@/lib/schemas/api/research";

export async function POST(req: Request): Promise<NextResponse> {
  try {
    await requireAuthUser();

    const body = postSchemaValidateSchema.parse(await req.json());
    const validation = validateSchemaJsonLd(body.jsonLd);

    return apiSuccess({ validation });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
