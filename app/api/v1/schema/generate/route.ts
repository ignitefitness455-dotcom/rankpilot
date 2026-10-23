import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import { generateSchemaJsonLd } from "@/lib/schema-gen/generator";
import { postSchemaGenerateSchema } from "@/lib/schemas/api/research";

export async function POST(req: Request): Promise<NextResponse> {
  try {
    await requireAuthUser();

    const body = postSchemaGenerateSchema.parse(await req.json());
    const generated = generateSchemaJsonLd(body);

    return apiSuccess(generated);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
