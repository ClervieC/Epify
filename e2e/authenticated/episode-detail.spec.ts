import { test, expect, Page } from "@playwright/test";

// Both tests below operate on the exact same episode (E1 of the same show)
// on the same shared test account — run in parallel (this project's
// default), they race each other's watched/rating state. This runs the
// whole file's tests one at a time instead.
test.describe.configure({ mode: "serial" });

const SHOW_ID = 1; // "Under the Dome" — see show-detail.spec.ts

// Navigates Show detail -> Episodes tab -> expand Season 1 -> open E1,
// mirroring how a real user actually reaches an episode (rather than
// guessing/hardcoding a TVmaze episode id) — this is also the "normal
// navigation" path requested.
async function openFirstEpisode(page: Page) {
  await page.goto(`/show/${SHOW_ID}`);
  await page.getByText("Episodes", { exact: true }).click();
  const firstEpisode = page.getByText(/^E1 ·/).first();
  // Season 1 auto-expands on load when it's the season the account is
  // currently on (see the "current season" effect in app/show/[id].tsx) —
  // only tap the season header if that didn't already happen, since
  // tapping an already-expanded season collapses it instead.
  if (!(await firstEpisode.isVisible().catch(() => false))) {
    await page.getByText("Season 1", { exact: true }).click();
  }
  await firstEpisode.click();
  await page.waitForURL(/\/episode\//, { timeout: 15_000 });
}

// The one live "Mark as ___" toggle for the episode actually open.
// expo-router's native-stack-on-web keeps the previous screen (the show
// page's own season list, which renders its own WatchedCheck for E1 too)
// mounted in the DOM underneath the current one after navigating here (same
// quirk noted in navigation.spec.ts's "Shows" tab-bar lookup), so both a
// stale and a live "Mark as ___" button can exist at once — sometimes with
// different labels if the state changed since the show page rendered its
// copy, which is exactly what made getByLabel(...).or(...) ambiguous
// (2 elements, not 1) instead of just picking a stale duplicate. .last()
// has to apply to the *combined* or() locator, not to each label
// individually, to actually collapse that down to the single current-screen
// element (the one appended most recently).
function watchedToggle(page: Page) {
  return page.getByLabel("Mark as watched").or(page.getByLabel("Mark as not watched")).last();
}

// A previous run of the "mark watched" test can leave E1 already marked
// watched if it crashed/timed out before reaching its own cleanup step —
// self-healing this rather than assuming a pristine starting state is what
// makes the suite reliable to re-run after a flake, instead of every test
// after the first failure cascading.
async function ensureUnwatched(page: Page) {
  const toggle = watchedToggle(page);
  // The real watched state loads asynchronously right after navigation
  // (see openFirstEpisode) — waiting for it first avoids an immediate
  // getAttribute() check below racing that load and wrongly concluding
  // "not watched" while the real answer just hasn't arrived yet.
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  if ((await toggle.getAttribute("aria-label")) === "Mark as not watched") {
    await toggle.click();
    // Already-watched -> tapping the toggle opens the rewatch/unwatch
    // confirmation dialog (see components/WatchedCheck.tsx's
    // askRewatch()) instead of toggling directly.
    await page.getByText("I haven't watched it", { exact: true }).click();
    await expect(watchedToggle(page)).toHaveAttribute("aria-label", "Mark as watched", { timeout: 10_000 });
  }
}

test("episode detail shows info and an unwatched prompt before marking watched", async ({ page }) => {
  await openFirstEpisode(page);
  await ensureUnwatched(page);
  // Rating/feelings/comments are gated behind marking the episode watched
  // (see app/episode/[id].tsx) — this confirms that gate is actually up
  // before the next test relies on getting past it.
  await expect(
    page.getByText("Mark this episode as watched to rate it, react, and see comments.")
  ).toBeVisible({ timeout: 10_000 });
});

// End-to-end: mark watched, rate, react with a feeling, comment — then
// undo all of it (delete comment, clear rating implicitly by unmarking
// watched) so this dedicated test account doesn't accumulate fake watch
// history across repeated runs.
test("can mark an episode watched, rate it, react, and comment", async ({ page }) => {
  test.setTimeout(60_000);
  await openFirstEpisode(page);
  await ensureUnwatched(page);

  await watchedToggle(page).click();
  await expect(page.getByText("Your rating", { exact: true })).toBeVisible({ timeout: 10_000 });

  // Marking an episode watched for a show this account isn't tracking (see
  // "Under the Dome" — SHOW_ID above) prompts to add it to the list (see
  // context/AddToListPromptContext.tsx) — dismissed here rather than
  // accepted so this dedicated test account's tracked-shows list stays
  // empty across repeated runs, same as its shows/movies counts.
  await page.getByText("Not now", { exact: true }).click();

  await page.getByLabel("Rate 4 stars").first().click();

  await expect(page.getByText("How did it make you feel?", { exact: true })).toBeVisible();
  await page.getByText("Thrilled", { exact: true }).click();

  const uniqueComment = `e2e episode comment ${Date.now()}`;
  await page.getByPlaceholder("Add a comment...").fill(uniqueComment);
  await page.getByLabel("Send comment").click();
  await expect(page.getByText(uniqueComment)).toBeVisible({ timeout: 15_000 });

  // Cleanup: delete the comment, then unmark the episode watched (clears
  // the rating/feeling along with it — see setEpisodeWatched(false) in
  // lib/userShows.ts, which deletes the watched_episodes row entirely).
  // The comment body Text and its row's delete button are siblings under
  // the same commentRow View (see components/CommentsSection.tsx) — going
  // up one level from the body text lands directly on that row, precisely,
  // rather than guessing at a containing div via a text filter.
  const commentRow = page.getByText(uniqueComment, { exact: true }).locator("xpath=..");
  await commentRow.getByLabel("Delete comment").click();
  await expect(page.getByText(uniqueComment)).not.toBeVisible({ timeout: 10_000 });

  await watchedToggle(page).click();
  // Same confirmation dialog as ensureUnwatched above.
  await page.getByText("I haven't watched it", { exact: true }).click();
  await expect(
    page.getByText("Mark this episode as watched to rate it, react, and see comments.")
  ).toBeVisible({ timeout: 10_000 });
});
