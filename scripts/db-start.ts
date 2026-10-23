import { ensureEmbeddedPostgresRunning, runFullSetup } from "./setup";
import { ensureDemoSeed } from "./seed";

async function main() {
  await runFullSetup({ stopEmbeddedAfter: false });
  await ensureDemoSeed();
  const stop = await ensureEmbeddedPostgresRunning();
  console.log("[db:start] Database is ready and listening on port 5432.");

  const shutdown = async () => {
    if (stop) await stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process alive while `concurrently` runs `next dev`
  setInterval(() => {}, 60_000);
}

main().catch((err) => {
  console.error("[db:start] Error:", err);
  process.exit(1);
});
