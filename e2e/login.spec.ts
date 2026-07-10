import { test, expect } from "@playwright/test";

// Smoke test: an unauthenticated visitor should land on the login screen
// and see its core elements, with no real Supabase auth required.
test("shows the login screen on first load", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Track your shows")).toBeVisible();
  await expect(page.getByPlaceholder("Email")).toBeVisible();
  await expect(page.getByPlaceholder("Password")).toBeVisible();
  await expect(page.getByText("Sign in", { exact: true })).toBeVisible();
});

test("navigates to signup and back via the links", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Sign up", { exact: true }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByText("Create an account")).toBeVisible();

  // .last() — the previous (login) screen's own "Sign in" button stays
  // mounted underneath (same native-stack-on-web quirk noted below), so
  // this matches twice; the signup page's link is the later one in the DOM.
  await page.getByText("Sign in", { exact: true }).last().click();
  await expect(page).toHaveURL(/\/login$/);
  // expo-router's native-stack-on-web keeps the previous screen mounted
  // (hidden) underneath during/after the transition, so this text can
  // legitimately match twice — only the newly-active instance (last in the
  // DOM) is expected to actually be visible.
  await expect(page.getByText("Track your shows").last()).toBeVisible();
});

// Exercises the real Supabase error path (invalid credentials) without
// needing a confirmed test account — signInWithPassword rejects bogus
// credentials the same way whether or not any account exists.
test("shows an error message for invalid credentials", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("Email").fill("no-such-user@example.invalid");
  await page.getByPlaceholder("Password").fill("wrong-password-123");
  await page.getByText("Sign in", { exact: true }).click();

  const error = page.locator("text=/invalid|Invalid/").first();
  await expect(error).toBeVisible({ timeout: 15_000 });
  // Still on the login screen — a failed sign-in must not navigate away.
  await expect(page).toHaveURL(/\/login$/);
});
