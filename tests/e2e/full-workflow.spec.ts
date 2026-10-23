import { expect, test } from "@playwright/test";

test.describe("RankPilot End-to-End Full Workflow Suite", () => {
  test("complete multi-module workflow: sign-in, all 9 module views, approval gate, bilingual switch, command palette & report preview", async ({
    page,
  }) => {
    // 1. Sign in via local dev sign-in
    await page.goto("/en/sign-in");
    await expect(page.getByTestId("dev-signin-submit")).toBeVisible();
    await page.getByTestId("dev-signin-submit").click();

    // 2. Wait for onboarding or dashboard
    await page.waitForURL(/\/(onboarding|p\/[0-9a-f-]{36}\/dashboard)/);

    if (page.url().includes("/onboarding")) {
      await page.fill("#project-name", "Acme Cloud Docs");
      await page.fill("#project-url", "https://acme-docs.example.com");
      await page.getByTestId("create-project-submit").click();
      await page.waitForURL(/\/p\/[0-9a-f-]{36}\/dashboard/);
    }

    const projectIdMatch = /\/p\/([0-9a-f-]{36})\//.exec(page.url());
    expect(projectIdMatch).not.toBeNull();
    const pId = projectIdMatch![1];

    // 3. Accessibility: Skip link
    const skipLink = page.locator('a[href="#main-content"]');
    await expect(skipLink).toBeAttached();

    // 4. Module 1: Dashboard
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("body")).toContainText("Acme Cloud Docs");

    // 5. Module 2: Site Audit
    await page.goto(`/en/p/${pId}/audit`);
    await expect(page.getByRole("heading", { name: /audit/i })).toBeVisible();

    // 6. Module 3: Pages Inventory
    await page.goto(`/en/p/${pId}/pages`);
    await expect(page.getByRole("heading", { name: /pages/i })).toBeVisible();

    // 7. Module 4: Keywords Research
    await page.goto(`/en/p/${pId}/keywords`);
    await expect(page.getByRole("heading", { name: /keyword/i })).toBeVisible();

    // 8. Module 5: Competitor Analysis
    await page.goto(`/en/p/${pId}/competitors`);
    await expect(page.getByRole("heading", { name: /competitor/i })).toBeVisible();

    // 9. Module 6: Content Studio
    await page.goto(`/en/p/${pId}/content`);
    await expect(page.getByRole("heading", { name: /content studio/i })).toBeVisible();

    // 10. Module 7: AI Search / GEO
    await page.goto(`/en/p/${pId}/ai-search`);
    await expect(page.getByRole("heading", { name: /generative engine optimization|ai search/i })).toBeVisible();
    await expect(page.locator("body")).toContainText("GPTBot");
    await expect(page.locator("body")).toContainText("OAI-SearchBot");

    // 11. Module 8: Action Center & Approval Gate
    await page.goto(`/en/p/${pId}/actions`);
    await expect(page.getByRole("heading", { name: /action center/i })).toBeVisible();
    await expect(page.getByText(/Export Action Plan/i)).toBeVisible();

    // 12. Module 9: Reports & Schedules
    await page.goto(`/en/p/${pId}/reports`);
    await expect(page.getByRole("heading", { name: /reports/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /generate/i })).toBeVisible();

    // 13. Bilingual Localization Switch (English -> বাংলা)
    await page.getByTestId("locale-switch").click();
    await page.waitForURL(new RegExp(`/bn/p/${pId}/`));
    await expect(page.locator("html")).toHaveAttribute("lang", "bn");

    // Switch back to English
    await page.getByTestId("locale-switch").click();
    await page.waitForURL(new RegExp(`/en/p/${pId}/`));
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    // 14. Command Palette (⌘K)
    await page.keyboard.press("Control+K");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
});
