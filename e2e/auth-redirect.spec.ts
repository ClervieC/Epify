import { test, expect } from "@playwright/test";

// Any route outside (auth) and legal/* requires a session — see the
// redirect effect in app/_layout.tsx. Deep-linking straight into a
// protected screen without one should always bounce to login instead of
// rendering (even briefly) with no data.
test("redirects an unauthenticated deep link to a protected route back to login", async ({ page }) => {
  await page.goto("/notifications");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Track your shows")).toBeVisible();
});
