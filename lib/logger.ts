import pino from "pino";
import { getEnv } from "./security/env";

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "*.password",
  "*.secret",
  "*.token",
  "*.access_token",
  "*.refresh_token",
  "*.apiKey",
  "*.ciphertext",
  "*.iv",
  "*.tag",
];

let instance: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (instance) return instance;
  let level: string = "info";
  try {
    level = getEnv().LOG_LEVEL;
  } catch {
    level = process.env.LOG_LEVEL ?? "info";
  }
  instance = pino({
    name: "rankpilot",
    level,
    redact: {
      paths: REDACT_PATHS,
      censor: "[REDACTED]",
    },
  });
  return instance;
}

export const logger = getLogger();
