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
  await page.getByText("Season 1", { exact: true }).click();
  await page.getByText(/^E1 ·/).first().click();
  await page.waitForURL(/\/episode\//, { timeout: 15_000 });
}

// A previous run of the "mark watched" test can leave E1 already marked
// watched if it crashed/timed out before reaching its own cleanup step —
// self-healing this rather than assuming a pristine starting state is what
// makes the suite reliable to re-run after a flake, instead of every test
// after the first failure cascading.
async function ensureUnwatched(page: Page) {
  const markAsNotWatched = page.getByLabel("Mark as not watched").first();
  if (await markAsNotWatched.isVisible().catch(() => false)) {
    await markAsNotWatched.click();
    await expect(page.getByLabel("Mark as watched").first()).toBeVisible({ timeout: 10_000 });
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

  // .first() — the desktop-width layout also renders an EpisodeSidebar
  // listing every episode in the season, each with its own "Mark as
  // watched" toggle; the main content's own toggle (for the episode
  // actually open) is first in the DOM.
  await page.getByLabel("Mark as watched").first().click();
  await expect(page.getByText("Your rating", { exact: true })).toBeVisible({ timeout: 10_000 });

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

  await page.getByLabel("Mark as not watched").first().click();
  await expect(
    page.getByText("Mark this episode as watched to rate it, react, and see comments.")
  ).toBeVisible({ timeout: 10_000 });
});
