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

  // A successful login navigates off /login.
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20_000 });

  // shouldShowOnboarding() (lib/onboarding.ts) routes to /onboarding
  // instead of the tabs whenever this account currently has zero tracked
  // shows AND zero movies — which can genuinely happen between runs, since
  // several specs deliberately unwatch/delete the one movie or episode they
  // touched as their own cleanup step. Without handling it, every
  // "authenticated" test would start mid-onboarding instead of logged into
  // the app, since they all reuse this one saved session.
  //
  // Setting the "onboarding_completed_v1" flag directly (the same
  // localStorage key/value lib/onboarding.ts's markOnboardingComplete()
  // itself writes — see its LegacyAsyncStorageWebImpl, plain
  // window.localStorage on web, no IndexedDB involved) rather than clicking
  // through the onboarding UI: that UI path depends on app/_layout.tsx's
  // own async redirect effect having settled on /onboarding by the time
  // this script checks for it, which proved to be a real, not just
  // theoretical, race — the flag write is unconditional and instant, no
  // race to get right.
  await page.evaluate(() => localStorage.setItem("onboarding_completed_v1", "true"));
  await page.goto("/");
  await page.getByText("My list", { exact: true }).waitFor({ timeout: 15_000 });

  // indexedDB capture is opt-in — without it, storageState() only saves
  // cookies/localStorage, and this app's Supabase session lives in
  // IndexedDB (see lib/supabase.ts's authStorage), so every "authenticated"
  // test would silently start logged out without this flag.
  await page.context().storageState({ path: authFile, indexedDB: true });
});
