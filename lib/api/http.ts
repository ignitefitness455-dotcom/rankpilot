import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UnauthorizedError } from "@/lib/auth";
import { BudgetExceededError } from "@/lib/ai/budget";
import { ForbiddenError, NotFoundError } from "@/lib/security/authz";
import { RateLimitError } from "@/lib/security/rate-limit";
import { getLogger } from "@/lib/logger";

export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

export function apiErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: err.message } },
      { status: 401 },
    );
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json(
      { ok: false, error: { code: "FORBIDDEN", message: err.message } },
      { status: 403 },
    );
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: err.message } },
      { status: 404 },
    );
  }
  if (err instanceof BudgetExceededError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "BUDGET_EXCEEDED",
          message: err.message,
          scope: err.scope,
          limitUsd: err.limitUsd,
          usedUsd: err.usedUsd,
        },
      },
      { status: 402 },
    );
  }
  if (err instanceof RateLimitError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: err.message,
          retryAfterSec: err.retryAfterSec,
        },
      },
      {
        status: 429,
        headers: { "Retry-After": String(err.retryAfterSec) },
      },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          issues: err.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
      },
      { status: 400 },
    );
  }

  getLogger().error({ err }, "Unhandled API route error");
  const message = err instanceof Error ? err.message : "Internal server error";
  return NextResponse.json(
    { ok: false, error: { code: "INTERNAL_ERROR", message } },
    { status: 500 },
  );
}
