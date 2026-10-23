import { expect, test } from "@playwright/test";

test.describe("Phase 1 Foundation E2E", () => {
  test("dev sign-in -> dashboard -> locale switch (EN/BN) -> BYOK settings -> offline shell", async ({
    page,
  }) => {
    await page.goto("/en/sign-in");
    await expect(page.getByTestId("dev-signin-submit")).toBeVisible();
    await page.getByTestId("dev-signin-submit").click();

    await page.waitForURL(/\/(onboarding|p\/.*\/dashboard)/);

    if (page.url().includes("/onboarding")) {
      await page.fill("#project-name", "E2E Test Site");
      await page.fill("#project-url", "https://e2e-site.example.com");
      await page.getByTestId("create-project-submit").click();
      await page.waitForURL(/\/p\/.*\/dashboard/);
    }

    await expect(page.getByTestId("dashboard-profile-preview")).toContainText("<project_profile");

    // Toggle Agent Drawer
    await page.getByTestId("agent-drawer-toggle").click();
    await expect(page.getByText("gemini-4-argon")).toBeVisible();

    // Switch locale EN -> বাংলা (BN)
    await page.getByTestId("locale-switch").click();
    await page.waitForURL(/\/bn\/p\/.*\/dashboard/);
    await expect(page.locator("html")).toHaveAttribute("lang", "bn");

    // Switch back to EN and test BYOK key encryption in Settings
    await page.getByTestId("locale-switch").click();
    await page.waitForURL(/\/en\/p\/.*\/dashboard/);

    await page.goto("/en/settings");
    await page.getByTestId("key-input-gemini_key").fill("AIzaSyTestE2EKey9999");
    await page.getByTestId("save-key-gemini_key").click();
    await expect(page.getByText(/••••9999/)).toBeVisible();

    // Verify PWA Offline Shell page
    await page.goto("/en/offline");
    await expect(page.getByRole("heading", { name: /offline/i })).toBeVisible();
  });
});
