import { test, expect } from "@playwright/test";

// components/CommentsSection.tsx is shared across show/episode/movie detail
// pages — these two behaviors (replying, and confirming before delete) are
// exercised once here on the show detail page rather than duplicated in
// show-detail.spec.ts/episode-detail.spec.ts/movie-detail.spec.ts, which
// only cover posting/deleting a plain top-level comment.
//
// Reporting a comment (the flag icon shown on someone *else's* comment —
// see components/CommentsSection.tsx's CommentRow) isn't covered here: this
// suite runs as a single test account (see e2e/auth.setup.ts), so there's no
// way to produce a comment authored by someone else to report through the
// UI. lib/reports.ts's createReport()/the admin queue are otherwise covered
// end-to-end by e2e/authenticated/admin.spec.ts's "report show" flow.

const SHOW_ID = 1; // "Under the Dome" — stable, already relied on elsewhere.

test.describe.configure({ mode: "serial" });

test("replying to a comment posts the reply directly under that comment's thread", async ({ page }) => {
  test.setTimeout(45_000);
  const parentText = `e2e reply-parent ${Date.now()}`;
  const replyText = `e2e reply-child ${Date.now()}`;

  await page.goto(`/show/${SHOW_ID}`);
  await page.getByText("Info", { exact: true }).first().click();
  await expect(page.getByText("Comments", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByPlaceholder("Add a comment...").fill(parentText);
  await page.getByLabel("Send comment").click();
  await expect(page.getByText(parentText, { exact: true })).toBeVisible({ timeout: 15_000 });

  const parentRow = page.getByText(parentText, { exact: true }).locator("xpath=..");
  await parentRow.getByText("Reply", { exact: true }).click();

  // The "Replying to <author>" bar and its input now render inline under
  // this specific comment (see CommentsSection.tsx's replyingTo?.id === c.id
  // block) — not at the top of the whole section — so the reply composer
  // should appear *after* the parent comment's own text in DOM order.
  await expect(page.getByText(/^Replying to /)).toBeVisible();
  const parentIndex = (await page.locator("body").innerText()).indexOf(parentText);
  const replyingToIndex = (await page.locator("body").innerText()).indexOf("Replying to");
  expect(replyingToIndex).toBeGreaterThan(parentIndex);

  await page.getByPlaceholder("Add a reply...").fill(replyText);
  await page.getByLabel("Send comment").click();
  await expect(page.getByText(replyText, { exact: true })).toBeVisible({ timeout: 15_000 });

  // The reply must render after (under) its parent, not above it.
  const bodyText = await page.locator("body").innerText();
  expect(bodyText.indexOf(replyText)).toBeGreaterThan(bodyText.indexOf(parentText));

  // Cleanup: delete the reply, then the parent — both need the confirm
  // dialog accepted (see lib/alert.ts's web fallback).
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByText(replyText, { exact: true }).locator("xpath=..").getByLabel("Delete comment").click();
  await expect(page.getByText(replyText, { exact: true })).not.toBeVisible({ timeout: 10_000 });

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByText(parentText, { exact: true }).locator("xpath=..").getByLabel("Delete comment").click();
  await expect(page.getByText(parentText, { exact: true })).not.toBeVisible({ timeout: 10_000 });
});

test("dismissing the delete confirmation keeps the comment", async ({ page }) => {
  test.setTimeout(30_000);
  const uniqueComment = `e2e delete-cancel ${Date.now()}`;

  await page.goto(`/show/${SHOW_ID}`);
  await page.getByText("Info", { exact: true }).first().click();
  await expect(page.getByText("Comments", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByPlaceholder("Add a comment...").fill(uniqueComment);
  await page.getByLabel("Send comment").click();
  await expect(page.getByText(uniqueComment, { exact: true })).toBeVisible({ timeout: 15_000 });

  const commentRow = page.getByText(uniqueComment, { exact: true }).locator("xpath=..");
  // Dismiss (Cancel), not accept — the comment must survive.
  page.once("dialog", (dialog) => dialog.dismiss());
  await commentRow.getByLabel("Delete comment").click();
  await page.waitForTimeout(1000);
  await expect(page.getByText(uniqueComment, { exact: true })).toBeVisible();

  // Now actually delete it so this test account's comment history stays
  // clean across repeated runs.
  page.once("dialog", (dialog) => dialog.accept());
  await commentRow.getByLabel("Delete comment").click();
  await expect(page.getByText(uniqueComment, { exact: true })).not.toBeVisible({ timeout: 10_000 });
});
