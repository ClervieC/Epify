import { supabase, getCurrentUserId } from "./supabase";
import { getCachedShow } from "./showDataCache";
import { getShow } from "./tvmaze";
import { mapWithConcurrency } from "./concurrency";
import { posterUrl } from "./tmdb";

const AVG_EPISODE_MINUTES = 42;
const AVG_MOVIE_MINUTES = 110;
// How many of the top shows (by episode count) get their TVmaze metadata
// (name/image/genres) fetched at all — needs to cover both the displayed
// top-5 list and enough breadth for the genre tally below it to be
// meaningful, not just how many actually get shown.
const TOP_SHOWS_FOR_GENRE = 15;
const TOP_SHOWS_DISPLAY = 5;
const RECAP_FETCH_CONCURRENCY = 4;
const PAGE_SIZE = 1000;

export interface RecapShow {
  showId: number;
  name: string;
  image: string | null;
  episodeCount: number;
}

export interface RecapMovie {
  movieId: string;
  title: string;
  image: string | null;
  timesWatched: number;
}

// A calendar year (the original "Wrapped"-style recap, seasonally gated —
// see isRecapAvailable) or a single calendar month (always available — see
// app/recap.tsx's mode switch). `month` is 0-indexed (0 = January), matching
// JS Date's own convention, since every call site already has a Date to
// pull it from.
export type RecapPeriod = { kind: "year"; year: number } | { kind: "month"; year: number; month: number };

export interface RecapData {
  period: RecapPeriod;
  totalEpisodesWatched: number;
  totalMoviesWatched: number;
  totalWatchTimeMinutes: number;
  // Sorted by episodeCount descending, longest list first — Year mode's
  // screen only ever renders topShows[0] (keeping that card's original
  // single-show look), Month mode renders the whole list.
  topShows: RecapShow[];
  // Sorted by timesWatched descending. Tracked separately from topShows
  // rather than folded into one combined list — components/RecapShareCard.tsx
  // uses this as its fallback "what to put a real poster of on the card"
  // when the period had no (or less-watched) TV at all, so a movie-only
  // period still gets a real photo instead of a flat background.
  topMovies: RecapMovie[];
  topGenre: string | null;
  newShowsStarted: number;
  daysActive: number;
}

// The Year recap is only surfaced (Profile's banner, and the screen's Year
// mode) during a "year in review" window — the last week of December
// through the first two weeks of January — same seasonal framing as Spotify
// Wrapped rather than a stat you'd stumble on any random Tuesday in March.
// The data itself doesn't disappear outside this window (computeRecap works
// year-round for any period passed in), only this one entry point's gating
// does.
export function isRecapAvailable(date: Date = new Date()): boolean {
  const month = date.getMonth(); // 0 = January, 11 = December
  const day = date.getDate();
  return (month === 11 && day >= 25) || (month === 0 && day <= 14);
}

// The current calendar year's Wrapped is still restricted to its own
// seasonal window above (isRecapAvailable) — asking for "my current year"
// stats mid-March reads as a half-finished stat, same reasoning as Month
// mode never showing the still-in-progress current month. But unlike
// Month mode, Year mode's browsable history goes back further than one
// period: every *past*, fully-ended year is always viewable any time of
// year — there's no reason last year's Wrapped should only be checkable
// during this specific 3-week window. This is what app/recap.tsx's Year
// mode defaults to and caps its forward chevron at, instead of a blanket
// "come back in December" gate on the whole mode.
export function maxViewableYear(date: Date = new Date()): number {
  const month = date.getMonth();
  const day = date.getDate();
  // Dec 25-31: this calendar year's own Wrapped just opened.
  if (month === 11 && day >= 25) return date.getFullYear();
  // Jan 1-14: still inside last calendar year's Wrapped window.
  if (month === 0 && day <= 14) return date.getFullYear() - 1;
  // Any other time: the current calendar year isn't over (and isn't in its
  // window either way), so the most recent fully viewable one is last year.
  return date.getFullYear() - 1;
}

// Unlike Year mode, Month mode has no window of its own — it's meant to
// stay reachable at any time (tried a once-a-week-ish window briefly; it
// meant a "come back later" dead end most of the month, including for
// looking back at a month that had already fully ended, which defeated the
// point). The only thing it restricts is which month: see lastViewableMonth
// below — a month that isn't over yet never shows, no matter when you look.

// The last month Month mode will ever show — the current, still-in-progress
// month is deliberately excluded (a recap of a month that isn't over yet
// reads as a half-finished stat, not a real summary), so this is also what
// app/recap.tsx caps its forward chevron at, and what it opens to by
// default.
export function lastViewableMonth(date: Date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1);
}

// The month Month mode opens to by default — always the month that just
// ended (same as lastViewableMonth; kept as its own named export so call
// sites read as "the default" rather than incidentally reusing the nav cap).
export function defaultRecapMonth(date: Date = new Date()): Date {
  return lastViewableMonth(date);
}

// "YYYY-MM" key for a given month — what
// components/NewMonthRecapToast.tsx compares against
// lib/lastSeenRecapMonth.ts's persisted value to know whether this device
// has already been notified that a given month's recap is ready.
export function recapMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function periodBounds(period: RecapPeriod): { start: string; end: string } {
  if (period.kind === "year") {
    return {
      start: new Date(Date.UTC(period.year, 0, 1)).toISOString(),
      end: new Date(Date.UTC(period.year + 1, 0, 1)).toISOString(),
    };
  }
  return {
    start: new Date(Date.UTC(period.year, period.month, 1)).toISOString(),
    end: new Date(Date.UTC(period.year, period.month + 1, 1)).toISOString(),
  };
}

function emptyRecap(period: RecapPeriod): RecapData {
  return {
    period,
    totalEpisodesWatched: 0,
    totalMoviesWatched: 0,
    totalWatchTimeMinutes: 0,
    topShows: [],
    topMovies: [],
    topGenre: null,
    newShowsStarted: 0,
    daysActive: 0,
  };
}

// Covers both a once-a-year computation (Year mode) and a once-a-month one
// (Month mode) — see app/recap.tsx. Neither is cached anywhere the way
// lib/showStats.ts's day-to-day stats are: a past period's watch history
// never changes once it's over, so there's no staleness to guard against,
// and re-running this on repeat visits to the screen is cheap enough (one
// page of history for that period, not the full account like showStats
// scans). The current, still-in-progress month recomputes fresh each visit
// for the same reason — it's cheap, and it's the one period actually still
// changing.
export async function computeRecap(period: RecapPeriod): Promise<RecapData> {
  const userId = await getCurrentUserId();
  if (!userId) return emptyRecap(period);

  const { start, end } = periodBounds(period);

  const episodes: { tvmaze_show_id: number; watched_at: string }[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("watched_episodes")
      .select("tvmaze_show_id, watched_at")
      .eq("user_id", userId)
      .gte("watched_at", start)
      .lt("watched_at", end)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    episodes.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  // A real row fetch rather than a head:true count — unlike watched_episodes
  // (TVmaze-only, needs its own fetch for name/image), user_movies already
  // carries title/poster_path on the row itself, so this one query covers
  // both the total count and topMovies below with no extra round trip.
  const { data: movieRows, error: movieError } = await supabase
    .from("user_movies")
    .select("id, title, poster_path, times_watched")
    .eq("user_id", userId)
    .eq("status", "watched")
    .gte("watched_at", start)
    .lt("watched_at", end);
  if (movieError) throw movieError;
  const movies = movieRows ?? [];
  const topMovies: RecapMovie[] = [...movies]
    .sort((a, b) => b.times_watched - a.times_watched)
    .slice(0, TOP_SHOWS_DISPLAY)
    .map((m) => ({
      movieId: m.id,
      title: m.title,
      image: posterUrl(m.poster_path, "w342"),
      timesWatched: m.times_watched,
    }));

  const countByShow = new Map<number, number>();
  const daysActive = new Set<string>();
  for (const ep of episodes) {
    countByShow.set(ep.tvmaze_show_id, (countByShow.get(ep.tvmaze_show_id) ?? 0) + 1);
    daysActive.add(ep.watched_at.slice(0, 10));
  }

  // Shows first watched (anywhere, not just this period) in this exact
  // period — "started" means the earliest watched_at for that show falls in
  // range, which needs each show's full history, not just this period's
  // slice above.
  const showIdsThisPeriod = [...countByShow.keys()];
  let newShowsStarted = 0;
  if (showIdsThisPeriod.length > 0) {
    const { data: firstWatchRows, error: firstWatchError } = await supabase
      .from("watched_episodes")
      .select("tvmaze_show_id, watched_at")
      .eq("user_id", userId)
      .in("tvmaze_show_id", showIdsThisPeriod)
      .order("watched_at", { ascending: true });
    if (firstWatchError) throw firstWatchError;
    const firstWatchByShow = new Map<number, string>();
    for (const row of firstWatchRows ?? []) {
      if (!firstWatchByShow.has(row.tvmaze_show_id)) firstWatchByShow.set(row.tvmaze_show_id, row.watched_at);
    }
    for (const showId of showIdsThisPeriod) {
      const first = firstWatchByShow.get(showId);
      if (first && first >= start && first < end) newShowsStarted += 1;
    }
  }

  const rankedShowIds = [...countByShow.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const showMetaById = new Map<number, { name: string; image: string | null }>();
  const genreTotals = new Map<string, number>();

  await mapWithConcurrency(rankedShowIds.slice(0, TOP_SHOWS_FOR_GENRE), RECAP_FETCH_CONCURRENCY, async (showId) => {
    try {
      const show = await getCachedShow(showId, () => getShow(showId));
      const episodeCount = countByShow.get(showId) ?? 0;
      for (const genre of show.genres) {
        genreTotals.set(genre, (genreTotals.get(genre) ?? 0) + episodeCount);
      }
      showMetaById.set(showId, { name: show.name, image: show.image?.medium ?? null });
    } catch {
      // Show metadata unavailable — skip it for both the top-shows list and
      // the genre tally.
    }
  });

  const topShows: RecapShow[] = rankedShowIds
    .filter((id) => showMetaById.has(id))
    .slice(0, TOP_SHOWS_DISPLAY)
    .map((showId) => ({
      showId,
      ...showMetaById.get(showId)!,
      episodeCount: countByShow.get(showId) ?? 0,
    }));

  const topGenre = [...genreTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const totalEpisodesWatched = episodes.length;
  const totalMoviesWatched = movies.length;
  const totalWatchTimeMinutes = totalEpisodesWatched * AVG_EPISODE_MINUTES + totalMoviesWatched * AVG_MOVIE_MINUTES;

  return {
    period,
    totalEpisodesWatched,
    totalMoviesWatched,
    totalWatchTimeMinutes,
    topShows,
    topMovies,
    topGenre,
    newShowsStarted,
    daysActive: daysActive.size,
  };
}
