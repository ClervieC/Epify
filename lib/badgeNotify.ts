import type { Badge } from "./streaks";

// Lets lib/userShows.ts and lib/userMovies.ts trigger an immediate badge
// recheck right after a watch/rate/rewatch mutation, without importing
// lib/streaks.ts (or context/BadgeUnlockContext.tsx) at the top of the
// file — both of those transitively import back into userShows.ts
// (fetchUserShows), so a static import here would be a circular import.
// The dynamic import() inside checkBadgesNow() below only resolves at call
// time, once every module involved has already finished loading, so the
// cycle never actually has to be walked during initial module evaluation.
let listener: ((badges: Badge[]) => void) | null = null;
let almostListener: ((badges: Badge[]) => void) | null = null;

// Called once by BadgeUnlockProvider (context/BadgeUnlockContext.tsx) on
// mount/unmount — nothing before the provider mounts (or after it unmounts)
// has anywhere to show a toast, so checkBadgesNow() below is a harmless
// no-op outside that window.
export function setBadgeUnlockListener(fn: ((badges: Badge[]) => void) | null) {
  listener = fn;
}

// Same lifecycle as setBadgeUnlockListener above, for the separate "1 away
// from unlocking" nudge toast (see getNewlyAlmostUnlocked in lib/streaks.ts).
export function setAlmostUnlockedListener(fn: ((badges: Badge[]) => void) | null) {
  almostListener = fn;
}

// Fire-and-forget: callers (setEpisodeWatched, setMovieWatched, ...) don't
// await this, so a badge recompute never adds latency to the tap that
// triggered it. Best-effort — a failure here (offline, etc.) just means the
// badge surfaces next time computeStreakData() runs from Shows/Profile/
// Streaks instead of right away.
export function checkBadgesNow() {
  import("./streaks")
    .then(({ computeStreakData }) =>
      computeStreakData((badges) => listener?.(badges), false, (badges) => almostListener?.(badges))
    )
    .catch(() => {});
}
