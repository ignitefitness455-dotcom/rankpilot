import { existsSync, copyFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import net from "node:net";
import { Client } from "pg";
import { getEnv } from "@/lib/security/env";
import { generatePwaIcons } from "./generate-icons";

export function isPortOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolvePromise(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolvePromise(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolvePromise(false);
    });
    socket.connect(port, host);
  });
}

export async function ensureEmbeddedPostgresRunning(): Promise<(() => Promise<void>) | null> {
  const env = getEnv();
  if (!env.EMBEDDED_PG) return null;

  const adminUrl = new URL(env.DATABASE_ADMIN_URL || env.DATABASE_URL);
  const port = Number(adminUrl.port || 5432);
  const alreadyUp = await isPortOpen(port, adminUrl.hostname);
  if (alreadyUp) {
    return null;
  }

  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const dataDir = resolve(process.cwd(), ".data", "postgres");
  mkdirSync(resolve(process.cwd(), ".data"), { recursive: true });

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: adminUrl.username || "postgres",
    password: adminUrl.password || "postgres",
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });

  if (!existsSync(resolve(dataDir, "PG_VERSION"))) {
    await pg.initialise();
  }
  await pg.start();

  const dbName = adminUrl.pathname.replace(/^\//, "") || "rankpilot";
  try {
    await pg.createDatabase(dbName);
  } catch {
    // Database already exists
  }

  return async () => {
    try {
      await pg.stop();
    } catch {
      // Ignore stop errors
    }
  };
}

export async function applyMigrationsAndRls(): Promise<void> {
  const env = getEnv();
  const connStr = env.DATABASE_ADMIN_URL || env.DATABASE_URL;
  const client = new Client({ connectionString: connStr });
  await client.connect();
  try {
    const initSql = readFileSync(
      resolve(process.cwd(), "drizzle", "migrations", "0000_init.sql"),
      "utf8",
    );
    await client.query(initSql);

    const rlsSql = readFileSync(resolve(process.cwd(), "drizzle", "rls.sql"), "utf8");
    await client.query(rlsSql);
  } finally {
    await client.end();
  }
}

export async function runFullSetup(options: { stopEmbeddedAfter?: boolean } = {}): Promise<void> {
  const root = process.cwd();
  const envPath = resolve(root, ".env");
  const envExamplePath = resolve(root, ".env.example");
  if (!existsSync(envPath) && existsSync(envExamplePath)) {
    copyFileSync(envExamplePath, envPath);
    console.log("[setup] Created .env from .env.example");
  }

  generatePwaIcons(root);
  console.log("[setup] Generated PWA icons in public/icons/");

  const stopEmbedded = await ensureEmbeddedPostgresRunning();
  try {
    await applyMigrationsAndRls();
    console.log("[setup] Applied database schema (0000_init.sql) and RLS policies (rls.sql)");
  } finally {
    if (options.stopEmbeddedAfter && stopEmbedded) {
      await stopEmbedded();
    }
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]).toLowerCase() === resolve(process.cwd(), "scripts", "setup.ts").toLowerCase();

if (isMain) {
  runFullSetup({ stopEmbeddedAfter: true })
    .then(() => {
      console.log("[setup] RankPilot setup complete.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[setup] Failed:", err);
      process.exit(1);
    });
}
