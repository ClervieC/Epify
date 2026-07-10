import { test, expect } from "@playwright/test";

// A normal browsing session: tab bar -> Explore -> search a show -> open
// its detail page -> back -> search a movie -> open its detail page -> back
// to the tab bar. Exercises real navigation (not direct URL goto()) end to
// end, unlike the other authenticated specs which jump straight to a
// detail route for speed.
test("browsing from Explore into a show and back, then into a movie and back", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/");
  await page.getByText("Explore", { exact: true }).click();
  await expect(page).toHaveURL(/\/explore$/);

  await page.getByPlaceholder("Search for a show or movie").fill("Under the Dome");
  // TMDB also has an unrelated movie called "Under the Dome", so this
  // query matches results in both the Shows and Movies sections — scope to
  // the Shows section specifically via "CBS" (the show's network, shown
  // only on its own card) rather than relying on DOM order via .first().
  const showsSection = page.locator("div").filter({ hasText: "Under the Dome" }).filter({ hasText: "CBS" }).last();
  await expect(showsSection).toBeVisible({ timeout: 15_000 });
  await showsSection.getByText("Under the Dome", { exact: false }).first().click();
  await expect(page).toHaveURL(/\/show\//, { timeout: 10_000 });
  await expect(page.getByText("Episodes", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.goBack();
  await expect(page).toHaveURL(/\/explore$/);
  // The actual bug this covers: opening a search result used to wipe the
  // search out from under the user (see the useFocusEffect blur comment in
  // app/(tabs)/explore.tsx), so pressing back landed on an empty Explore
  // instead of back on their results.
  await expect(page.getByPlaceholder("Search for a show or movie")).toHaveValue("Under the Dome");

  await page.getByPlaceholder("Search for a show or movie").fill("Fight Club");
  // The movie's overview text also happens to contain "Fight Club" (it's
  // literally what the plot is about), but that's only on the detail page,
  // not this search results grid — .first() (the card title) is safe here.
  await expect(page.getByText("Fight Club").first()).toBeVisible({ timeout: 15_000 });
  await page.getByText("Fight Club").first().click();
  await expect(page).toHaveURL(/\/movie\/tmdb\//, { timeout: 10_000 });
  await expect(page.getByText("Cast", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.goBack();
  await expect(page).toHaveURL(/\/explore$/);
});

// Tab-bar-only navigation across all four tabs, confirming each one's own
// signature content shows up — the baseline "does normal navigation work"
// smoke test.
test("navigating through all four tabs in sequence", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("My list", { exact: true })).toBeVisible();

  await page.getByText("Movies", { exact: true }).click();
  await expect(page).toHaveURL(/\/movies$/);

  await page.getByText("Explore", { exact: true }).click();
  await expect(page).toHaveURL(/\/explore$/);

  await page.getByText("Profile", { exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByText("Statistics", { exact: true })).toBeVisible();

  // "Shows" also appears as a section header on the Profile screen (and,
  // per expo-router's native-stack-on-web quirk seen elsewhere in this
  // suite, possibly on a previous screen kept mounted underneath) — the
  // tab bar's own instance is the persistent one, last in the DOM.
  await page.getByText("Shows", { exact: true }).last().click();
  await expect(page).toHaveURL(/\/$|\/index$/);
  await expect(page.getByText("My list", { exact: true })).toBeVisible();
});
