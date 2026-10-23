import { and, asc, desc, eq } from "drizzle-orm";
import { executeCrawlById } from "@/lib/crawler/runner";
import { closeAllPools, getAdminDb } from "@/lib/db/client";
import { crawls, projects, reports, reportSchedules } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { sendReportEmailViaSmtp } from "@/lib/reports/mailer";
import { generateProjectReport, isReportScheduleDue } from "@/lib/reports/service";

const POLL_INTERVAL_MS = 3_000;
let shuttingDown = false;
let pollTickCount = 0;

async function pollQueuedCrawlsOnce(): Promise<void> {
  const adminDb = getAdminDb();

  const queuedRows = await adminDb
    .select({
      crawlId: crawls.id,
      projectId: crawls.projectId,
      ownerId: projects.ownerId,
    })
    .from(crawls)
    .innerJoin(projects, eq(crawls.projectId, projects.id))
    .where(eq(crawls.status, "queued"))
    .orderBy(asc(crawls.createdAt))
    .limit(2);

  for (const row of queuedRows) {
    if (shuttingDown) break;
    logger.info(
      { crawlId: row.crawlId, projectId: row.projectId },
      "Worker picked up queued crawl",
    );
    await executeCrawlById(row.crawlId, row.ownerId);
  }
}

/**
 * Checks active `report_schedules` and generates + emails a new report if no report
 * has been generated within the cadence window (`weekly` = 7 days, `monthly` = 30 days).
 */
async function pollDueReportSchedulesOnce(): Promise<void> {
  const adminDb = getAdminDb();

  const activeSchedules = await adminDb
    .select({
      scheduleId: reportSchedules.id,
      projectId: reportSchedules.projectId,
      cadence: reportSchedules.cadence,
      locale: reportSchedules.locale,
      recipients: reportSchedules.recipients,
      ownerId: projects.ownerId,
      projectName: projects.name,
    })
    .from(reportSchedules)
    .innerJoin(projects, eq(reportSchedules.projectId, projects.id))
    .where(eq(reportSchedules.active, true))
    .limit(10);

  for (const sched of activeSchedules) {
    if (shuttingDown) break;

    const [latestReport] = await adminDb
      .select({ createdAt: reports.createdAt })
      .from(reports)
      .where(
        and(
          eq(reports.projectId, sched.projectId),
          eq(reports.period, sched.cadence),
        ),
      )
      .orderBy(desc(reports.createdAt))
      .limit(1);

    if (
      !isReportScheduleDue({
        cadence: sched.cadence,
        lastReportAt: latestReport?.createdAt ?? null,
      })
    ) {
      continue;
    }

    logger.info(
      { scheduleId: sched.scheduleId, projectId: sched.projectId },
      "Worker generating scheduled executive SEO report",
    );

    const generated = await generateProjectReport({
      userId: sched.ownerId,
      projectId: sched.projectId,
      period: sched.cadence,
      locale: sched.locale === "bn" ? "bn" : "en",
    });

    if (sched.recipients && sched.recipients.length > 0 && generated.html) {
      const emailRes = await sendReportEmailViaSmtp({
        to: sched.recipients,
        subject: `[RankPilot] ${sched.projectName} — ${sched.cadence.toUpperCase()} SEO Report (${generated.rangeStart} → ${generated.rangeEnd})`,
        html: generated.html,
      });
      logger.info(
        {
          scheduleId: sched.scheduleId,
          delivered: emailRes.delivered,
          recipientsCount: emailRes.recipients.length,
          error: emailRes.error,
        },
        "Worker finished scheduled report email dispatch",
      );
    }
  }
}

async function main() {
  logger.info(
    "RankPilot background worker started (polling queued crawls & report schedules)",
  );

  const handleSignal = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down RankPilot background worker...");
    await closeAllPools();
    process.exit(0);
  };

  process.on("SIGINT", () => void handleSignal("SIGINT"));
  process.on("SIGTERM", () => void handleSignal("SIGTERM"));

  while (!shuttingDown) {
    try {
      await pollQueuedCrawlsOnce();
      // Poll due report schedules every 10 ticks (~30s)
      if (pollTickCount % 10 === 0) {
        await pollDueReportSchedulesOnce();
      }
      pollTickCount += 1;
    } catch (err) {
      logger.error({ err }, "Worker poll loop error");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

void main();
