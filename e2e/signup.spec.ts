import { test, expect } from "@playwright/test";

test("shows the signup screen with its core fields", async ({ page }) => {
  await page.goto("/signup");

  await expect(page.getByText("Create an account")).toBeVisible();
  await expect(page.getByPlaceholder("Email")).toBeVisible();
  await expect(page.getByPlaceholder("Username")).toBeVisible();
  await expect(page.getByPlaceholder("Password")).toBeVisible();
  await expect(page.getByText("Sign up", { exact: true })).toBeVisible();
});

// Username validation runs client-side before any network call, so this
// doesn't touch Supabase or need a real/confirmed account.
test("rejects an invalid username before submitting", async ({ page }) => {
  await page.goto("/signup");

  await page.getByPlaceholder("Email").fill("someone@example.com");
  await page.getByPlaceholder("Username").fill("a"); // too short — must be 3-20 chars
  await page.getByPlaceholder("Password").fill("some-password-123");
  await page.getByText("Sign up", { exact: true }).click();

  await expect(page.getByText("3 to 20 letters, numbers or underscores.")).toBeVisible();
});
