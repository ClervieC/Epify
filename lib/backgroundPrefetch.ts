import { fetchUserShows, fetchWatchedEpisodes } from "./userShows";
import { fetchUserMovieTmdbMap } from "./userMovies";
import { getShowEpisodes } from "./tvmaze";
import { getCachedEpisodes, getCachedWatchedEpisodes } from "./showDataCache";
import { getMovieDetails, getMovieCast } from "./tmdb";
import { computeShowStats, fetchCachedShowStats, saveShowStats } from "./showStats";
import { mapWithConcurrency } from "./concurrency";

const PREFETCH_CONCURRENCY = 4;

// Mirrors app/stats/shows.tsx's own TTL — same cache, same "don't recompute
// if it's still fresh" rule, just triggered on app launch instead of on
// first visit to the stats screen, so the screen almost always opens on an
// up-to-date number instead of showing a stale one while it recomputes.
const STATS_TTL_MS = 6 * 60 * 60 * 1000;

let started = false;

// Warms every on-disk cache (lib/showDataCache.ts, lib/tvmaze.ts, lib/tmdb.ts
// — all IndexedDB-backed, see their own comments) for the user's *entire*
// library, not just the Shows tab's watching/want_to_watch shows — so
// opening any show or movie's detail page, even one you haven't touched in
// months, is instant and works offline. Fire-and-forget: nothing in the UI
// waits on this, and TVmaze calls already go through tvmaze.ts's "low"
// priority queue, so this never delays an interactive fetch (search,
// opening a screen) queued after it. `started` makes this a once-per-session
// no-op on repeat calls (e.g. every time the Shows tab re-focuses).
export async function prefetchLibrary(): Promise<void> {
  if (started) return;
  started = true;

  try {
    const [shows, movieMap] = await Promise.all([fetchUserShows(), fetchUserMovieTmdbMap()]);

    await mapWithConcurrency(shows, PREFETCH_CONCURRENCY, async (show) => {
      await Promise.allSettled([
        getCachedEpisodes(show.tvmaze_id, () => getShowEpisodes(show.tvmaze_id)),
        getCachedWatchedEpisodes(show.tvmaze_id, () => fetchWatchedEpisodes(show.tvmaze_id)),
      ]);
    });

    const movies = Array.from(movieMap.values()).filter((m) => m.tmdb_id != null);
    await mapWithConcurrency(movies, PREFETCH_CONCURRENCY, async (movie) => {
      await Promise.allSettled([getMovieDetails(movie.tmdb_id!), getMovieCast(movie.tmdb_id!)]);
    });

    // Last thing this does, deliberately — the heaviest single piece of work
    // here (a full watched_episodes scan plus a TVmaze call per show), and
    // the least urgent: nothing on screen needs it until the user actually
    // opens the stats page (see app/stats/shows.tsx).
    const cachedStats = await fetchCachedShowStats().catch(() => null);
    const isStale = !cachedStats || Date.now() - new Date(cachedStats.computedAt).getTime() > STATS_TTL_MS;
    if (isStale) {
      const fresh = await computeShowStats();
      await saveShowStats(fresh);
    }
  } catch {
    // Best-effort — a failure here just means some detail pages fetch fresh
    // instead of hitting a warm cache later. Nothing user-visible depends on
    // this succeeding, so there's nothing to retry or surface.
  }
}

// Called on sign-out (see context/AuthContext.tsx) — without this, `started`
// stays true forever after the very first session, so signing into a
// different account on the same device would silently skip prefetching
// that account's library entirely.
export function resetPrefetchState(): void {
  started = false;
}
