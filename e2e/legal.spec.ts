import { test, expect } from "@playwright/test";

// Legal pages are deliberately reachable without a session (see the
// isLegalRoute bypass in app/_layout.tsx) — app stores expect a privacy
// policy link that works for someone who hasn't signed up yet.
test("terms page is reachable without logging in", async ({ page }) => {
  await page.goto("/legal/terms");
  await expect(page.getByText("Terms & Conditions")).toBeVisible();
  await expect(page.getByText("1. About Epify")).toBeVisible();
});

test("privacy policy page is reachable without logging in", async ({ page }) => {
  await page.goto("/legal/privacy");
  await expect(page.getByText("Privacy Policy")).toBeVisible();
});
