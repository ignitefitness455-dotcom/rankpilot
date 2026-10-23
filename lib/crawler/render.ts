import { validateUrlTarget, type SsrfValidationOptions } from "@/lib/security/ssrf";

export interface RenderedPageResult {
  finalUrl: string;
  statusCode: number;
  html: string;
  renderTimeMs: number;
  usedHeadless: boolean;
  fallbackReason?: string;
}

export interface RenderOptions {
  timeoutMs?: number;
  userAgent?: string;
  ssrfOptions?: SsrfValidationOptions;
}

const DEFAULT_USER_AGENT = "RankPilotBot/1.0 (+https://rankpilot.local/bot; HeadlessAudit)";

/**
 * Renders a URL using headless Chromium via Playwright with SSRF validation
 * enforced on the initial request and every network sub-request (`page.route`).
 */
export async function renderPageWithPlaywright(
  targetUrl: string,
  options: RenderOptions = {},
): Promise<RenderedPageResult> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  // Validate initial target URL against SSRF before launching browser
  const initialCheck = await validateUrlTarget(targetUrl, options.ssrfOptions);

  const startedAt = Date.now();
  const playwright = await import("playwright");

  let browser;
  try {
    browser = await playwright.chromium.launch({
      headless: true,
      args: ["--disable-dev-shm-usage", "--no-sandbox"],
    });
  } catch (error) {
    throw new Error(
      `Playwright Chromium launch failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const context = await browser.newContext({
      userAgent,
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: false,
    });
    const page = await context.newPage();

    // Enforce SSRF protection on every sub-request initiated by the page
    await page.route("**/*", async (route) => {
      const reqUrl = route.request().url();
      if (reqUrl.startsWith("data:") || reqUrl.startsWith("blob:")) {
        await route.continue();
        return;
      }
      try {
        await validateUrlTarget(reqUrl, options.ssrfOptions);
        await route.continue();
      } catch {
        await route.abort("accessdenied");
      }
    });

    const response = await page.goto(initialCheck.url.toString(), {
      waitUntil: "networkidle",
      timeout: timeoutMs,
    });

    const html = await page.content();
    const finalUrl = page.url();

    // Also validate final URL in case client-side navigation redirected somewhere
    await validateUrlTarget(finalUrl, options.ssrfOptions);

    await context.close();

    return {
      finalUrl,
      statusCode: response?.status() ?? 200,
      html,
      renderTimeMs: Date.now() - startedAt,
      usedHeadless: true,
    };
  } finally {
    await browser.close();
  }
}
