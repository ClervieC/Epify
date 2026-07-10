import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/profile");
});

test("Show watch time stat card opens the stats detail page", async ({ page }) => {
  await page.getByText("Show watch time", { exact: true }).click();
  await expect(page.getByText("Show stats", { exact: true })).toBeVisible();
});

test("Episodes watched stat card opens the stats detail page", async ({ page }) => {
  await page.getByText("Episodes watched", { exact: true }).click();
  await expect(page.getByText("Show stats", { exact: true })).toBeVisible();
});

test("stats detail page renders without crashing", async ({ page }) => {
  await page.getByText("Episodes watched", { exact: true }).click();
  await expect(page.getByText("Show stats", { exact: true })).toBeVisible();

  // A crash here means the app's ErrorBoundary took over and swallowed the
  // whole screen — this is the regression check for that (see the
  // undefined-field crashes this screen has hit before, when a cached
  // show_stats_cache row predated a field the UI now always reads). Only
  // asserting the empty-state OR the weekly chart, not every card, since
  // which cards render depends on this account's actual watch history.
  await expect(page.locator("text=/Episodes per week|Watch a few episodes/").first()).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText("Something went wrong", { exact: true })).toHaveCount(0);
});

// Regression test for the back-button-after-refresh bug: router.back() alone
// is a no-op once a hard refresh wipes browser history down to just the
// current URL (see lib/useGoBack.ts) — reload this page directly (bypassing
// any in-app navigation history) and confirm the back button still lands
// somewhere sensible instead of doing nothing.
test("back button works after a hard refresh", async ({ page }) => {
  await page.getByText("Episodes watched", { exact: true }).click();
  await expect(page.getByText("Show stats", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Show stats", { exact: true })).toBeVisible();

  await page.getByLabel("Back").click();
  await expect(page).toHaveURL(/\/profile/);
});
