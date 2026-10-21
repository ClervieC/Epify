import { test } from "@playwright/test";

test("rewatch confirm flow check", async ({ page }) => {
  test.setTimeout(60_000);
  const email = process.env.E2E_TEST_EMAIL!;
  const password = process.env.E2E_TEST_PASSWORD!;

  page.on("response", async (res) => {
    if (res.status() >= 400) console.log("[http-error]", res.status(), res.url());
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByText("Sign in", { exact: true }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20_000 });
  await page.evaluate(() => localStorage.setItem("onboarding_completed_v1", "true"));
  await page.goto("/");
  await page.getByText("My list", { exact: true }).waitFor({ timeout: 15_000 });

  async function shareFriendsS1E1() {
    await page.goto("/rooms/8830f719-434f-4f38-a698-ed05e8819515");
    await page.waitForTimeout(1200);
    await page.getByLabel("Add something you watched together").click();
    await page.waitForTimeout(500);
    await page.getByPlaceholder("Search a show").fill("Friends");
    await page.waitForTimeout(1200);
    await page.getByText("Friends", { exact: true }).first().click();
    await page.waitForTimeout(800);
    await page.getByText("Season 1", { exact: false }).first().click();
    await page.waitForTimeout(500);
  }

  await shareFriendsS1E1();
  await page.screenshot({ path: "/tmp/rewatch-season-list.png" });
  await page.locator("text=/E1 /").first().click();
  await page.waitForTimeout(1500);

  // Second share of the same episode.
  await shareFriendsS1E1();
  await page.locator("text=/E1 /").first().click();
  await page.waitForTimeout(1500);
});
