import { test, expect } from "@playwright/test";

// Coverage for app/(tabs)/movies.tsx's three sub-tabs (Watched/To Watch/
// Upcoming) and the To Watch sort toggle — none of this had dedicated e2e
// coverage before (movie-detail.spec.ts only covers a single movie's own
// detail page, tabs.spec.ts only proves the Movies tab itself is reachable).

test("switching between Watched, To Watch, and Upcoming sub-tabs works", async ({ page }) => {
  await page.goto("/movies");
  await expect(page.getByText("Watched", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByText("To Watch", { exact: true }).click();
  // Either real rows or the dedicated empty state — either way, no crash
  // and the tab actually switched (not just cosmetically, since Watched's
  // own grid/empty state would otherwise still be showing).
  await expect(
    page
      .getByText("Your watchlist is empty", { exact: false })
      .or(page.getByLabel("Mark as watched").first())
  ).toBeVisible({ timeout: 15_000 });

  // "Upcoming" also matches the Shows tab's own sub-tab of the same name,
  // which expo-router-on-web keeps mounted underneath this screen (same
  // quirk documented in e2e/authenticated/episode-detail.spec.ts) — .last()
  // is this page's own tab, not the stale one from Shows.
  await page.getByText("Upcoming", { exact: true }).last().click();
  await expect(page.getByText("Something went wrong")).not.toBeVisible();
});

test("To Watch sort direction toggles and persists across a reload", async ({ page }) => {
  await page.goto("/movies");
  await page.getByText("To Watch", { exact: true }).click();

  // The button's accessibilityLabel names the *next* action (see
  // app/(tabs)/movies.tsx) — starts ascending, so it initially offers to
  // switch to descending.
  const sortBtn = page.getByLabel("Newest first").or(page.getByLabel("Oldest first"));
  await expect(sortBtn).toBeVisible({ timeout: 15_000 });
  const initiallyDescending = await page.getByLabel("Newest first").isVisible().catch(() => false);

  await sortBtn.click();
  if (initiallyDescending) {
    await expect(page.getByLabel("Oldest first")).toBeVisible();
  } else {
    await expect(page.getByLabel("Newest first")).toBeVisible();
  }

  // Persisted via AsyncStorage (see SORT_STORAGE_KEY) — a reload should come
  // back in the direction just picked, not silently reset to ascending.
  await page.reload();
  await page.getByText("To Watch", { exact: true }).click();
  if (initiallyDescending) {
    await expect(page.getByLabel("Oldest first")).toBeVisible({ timeout: 15_000 });
  } else {
    await expect(page.getByLabel("Newest first")).toBeVisible({ timeout: 15_000 });
  }

  // Restore the original direction so repeated runs of this test (and any
  // other test relying on the default sort) aren't affected by this one.
  await page.getByLabel("Oldest first").or(page.getByLabel("Newest first")).click();
});

test("the Watched tab's header count pill renders a number", async ({ page }) => {
  await page.goto("/movies");
  // The count pill sits right next to the "Movies" header title (see
  // app/(tabs)/movies.tsx's unconditional `tab === "list" && <Pill>`) and is
  // present even at a count of 0 — this just confirms some digit actually
  // renders there instead of the header silently dropping it.
  const header = page.getByText("Movies", { exact: true }).first().locator("xpath=..");
  await expect(header.getByText(/^\d+$/)).toBeVisible({ timeout: 15_000 });
});
