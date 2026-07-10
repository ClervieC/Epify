import { test as setup, expect } from "@playwright/test";

const authFile = "e2e/.auth/user.json";

// Logs in once with a dedicated test account (causer.clervie@gmail.com —
// see .env's E2E_TEST_EMAIL/E2E_TEST_PASSWORD, not committed) and saves the
// resulting session so every test in the "authenticated" project (see
// playwright.config.ts) starts already logged in instead of repeating this
// login flow itself. This account is also an admin (profiles.is_admin —
// see supabase/schema.sql) specifically so the admin panel can be tested
// too, not just regular authenticated screens.
setup("authenticate", async ({ page }) => {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error("E2E_TEST_EMAIL/E2E_TEST_PASSWORD must be set (see .env) to run authenticated e2e tests.");
  }

  await page.goto("/");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByText("Sign in", { exact: true }).click();

  // A successful login navigates off /login into the tabs — waiting for
  // that (rather than a fixed delay) is what makes this robust regardless
  // of how long the post-login data load (see app/(tabs)/index.tsx) takes.
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20_000 });

  // indexedDB capture is opt-in — without it, storageState() only saves
  // cookies/localStorage, and this app's Supabase session lives in
  // IndexedDB (see lib/supabase.ts's authStorage), so every "authenticated"
  // test would silently start logged out without this flag.
  await page.context().storageState({ path: authFile, indexedDB: true });
});
