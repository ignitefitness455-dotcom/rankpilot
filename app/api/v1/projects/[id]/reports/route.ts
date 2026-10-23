import { NextResponse } from "next/server";
import { apiErrorResponse, apiSuccess } from "@/lib/api/http";
import { requireAuthUser } from "@/lib/auth";
import {
  generateProjectReport,
  listProjectReportsAndAlerts,
  upsertProjectReportSchedule,
} from "@/lib/reports/service";
import {
  postGenerateReportSchema,
  putReportScheduleSchema,
} from "@/lib/schemas/api/ops";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { id: projectId } = await context.params;
    const overview = await listProjectReportsAndAlerts(user.id, projectId);
    return apiSuccess(overview);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { id: projectId } = await context.params;
    const body = postGenerateReportSchema.parse(await req.json().catch(() => ({})));

    const report = await generateProjectReport({
      userId: user.id,
      projectId,
      period: body.period,
      locale: body.locale,
    });

    return apiSuccess({ report }, 201);
  } catch (err) {
    return apiErrorResponse(err);
  }
}

export async function PUT(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await requireAuthUser();
    const { id: projectId } = await context.params;
    const body = putReportScheduleSchema.parse(await req.json());

    const schedule = await upsertProjectReportSchedule({
      userId: user.id,
      projectId,
      cadence: body.cadence,
      day: body.day,
      hour: body.hour,
      tz: body.tz,
      recipients: body.recipients,
      locale: body.locale,
      active: body.active,
    });

    return apiSuccess({ schedule });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
