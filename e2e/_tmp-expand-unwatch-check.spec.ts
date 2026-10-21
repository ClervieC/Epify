import { test } from "@playwright/test";

test("expand episodes and per-episode undo check", async ({ page }) => {
  test.setTimeout(60_000);
  const email = process.env.E2E_TEST_EMAIL!;
  const password = process.env.E2E_TEST_PASSWORD!;

  page.on("response", async (res) => {
    if (res.status() >= 400) console.log("[http-error]", res.status(), res.url());
  });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByText("Sign in", { exact: true }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20_000 });
  await page.evaluate(() => localStorage.setItem("onboarding_completed_v1", "true"));
  await page.goto("/");
  await page.getByText("My list", { exact: true }).waitFor({ timeout: 15_000 });

  // "Test" room (test + clervie) already has "Adults" logged — read-only
  // check, deliberately not touching the undo button (real watch data).
  await page.goto("/rooms/8830f719-434f-4f38-a698-ed05e8819515");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "/tmp/room-collapsed.png", fullPage: true });

  await page.getByText("Adults", { exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/room-expanded.png", fullPage: true });
});
