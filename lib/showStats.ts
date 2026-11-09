import { createAsyncStorage } from "@react-native-async-storage/async-storage";
import { supabase, getCurrentUserId } from "./supabase";
import { fetchUserShows, WatchedEpisode } from "./userShows";
import { getCachedShow, getCachedEpisodes, peekCachedShow } from "./showDataCache";
import { getShow, getShowEpisodes } from "./tvmaze";
import { mapWithConcurrency } from "./concurrency";
import { todayISODate, realBingeCount } from "./dates";
import { averageRuntime, totalRuntime } from "./runtime";

// IndexedDB-backed (see the same comment in lib/showDataCache.ts for why —
// not the default AsyncStorage export, which is a localStorage-backed
// singleton with a much smaller quota). This is a local mirror of the
// show_stats_cache Supabase table below: reading it needs no network round
// trip at all, so app/stats/shows.tsx can paint instantly from the very last
// computed stats even before the Supabase row comes back (or offline).
// Supabase stays the source of truth (it's what syncs across a user's
// devices); this is purely a same-device speed/offline layer on top of it.
const localStatsStore = createAsyncStorage("show_stats_cache");
const LOCAL_STORAGE_KEY = "show_stats_v1";

// Weeks/months shown on the "episodes/week" and "episodes/month" charts on
// the stats detail screen.
const WEEK_COUNT = 8;
const MONTH_COUNT = 6;
const STATS_FETCH_CONCURRENCY = 4;
const PAGE_SIZE = 1000;

// Bumped whenever ShowStats's shape changes (last: adding remainingMinutes/
// notStartedMinutes) —
// a row cached under an older version is missing fields the UI now assumes
// exist unconditionally (e.g. episodesPerMonth.map crashing on undefined), so
// fetchCachedShowStats() below treats a version mismatch as "no cache" and
// triggers an immediate recompute instead of returning the stale shape as-is.
const STATS_SCHEMA_VERSION = 8;

export interface WeekBucket {
  weekStart: string; // ISO date (Monday) of that bucket
  count: number;
}

export interface MonthBucket {
  monthStart: string; // ISO date (1st of that month)
  count: number;
}

export interface GenreCount {
  genre: string;
  count: number;
}

export interface TopShow {
  showId: number;
  name: string;
  image: string | null;
  episodeCount: number;
}

export interface TopMovie {
  movieId: string;
  title: string;
  year: number | null;
  posterPath: string | null;
  timesWatched: number;
}

export interface ShowStats {
  schemaVersion: number;
  episodesPerWeek: WeekBucket[];
  averagePerWeek: number;
  episodesPerMonth: MonthBucket[];
  averagePerMonth: number;
  totalEpisodesWatched: number;
  remainingEpisodes: number;
  notStartedEpisodes: number;
  // Time it'd take to watch those episodes, from each episode's own TVmaze
  // runtime (see lib/runtime.ts for the fallback when it's missing).
  remainingMinutes: number;
  notStartedMinutes: number;
  genreBreakdown: GenreCount[];
  topShows: TopShow[];
  totalMoviesWatched: number;
  moviesPerMonth: MonthBucket[];
  averageMoviesPerMonth: number;
  topMovies: TopMovie[];
  computedAt: string;
}

// Monday-based week key so "this week" always groups the same regardless of
// which day the user opens the screen on.
function weekStartOf(dateIso: string): string {
  const d = new Date(dateIso);
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function monthStartOf(dateIso: string): string {
  const d = new Date(dateIso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

type WatchedRow = Pick<WatchedEpisode, "tvmaze_show_id" | "tvmaze_episode_id" | "watched_at">;

// Only the three columns the stats use, and every page after the first
// fetched at once — the biggest accounts have 20,000+ rows, which used to
// be 20+ full-row pages fetched one after another.
async function fetchAllWatchedEpisodes(): Promise<WatchedRow[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  const columns = "tvmaze_show_id, tvmaze_episode_id, watched_at";
  const page = (offset: number) =>
    supabase
      .from("watched_episodes")
      .select(columns, offset === 0 ? { count: "exact" } : undefined)
      .eq("user_id", userId)
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);

  const first = await page(0);
  if (first.error) throw first.error;
  const all = [...((first.data as WatchedRow[]) ?? [])];
  const total = first.count ?? all.length;
  if (all.length < PAGE_SIZE || total <= PAGE_SIZE) return all;
  const offsets: number[] = [];
  for (let o = PAGE_SIZE; o < total; o += PAGE_SIZE) offsets.push(o);
  const rest = await mapWithConcurrency(offsets, 6, async (o) => {
    const { data, error } = await page(o);
    if (error) throw error;
    return (data as WatchedRow[]) ?? [];
  });
  for (const r of rest) all.push(...r);
  return all;
}

// The TVmaze-heavy half (genres, remaining / not-started episodes and
// minutes), computed in Postgres from the shared TVmaze cache — see
// my_show_stats_heavy in supabase/schema.sql. Returns null when the call
// fails, so the caller can fall back to doing it all here.
interface HeavyStats {
  remaining_episodes: number;
  remaining_minutes: number;
  not_started_episodes: number;
  not_started_minutes: number;
  genres: GenreCount[];
  missing_episodes: number[];
  missing_shows: number[];
}

async function fetchHeavyStats(): Promise<HeavyStats | null> {
  try {
    const { data, error } = await supabase.rpc("my_show_stats_heavy");
    if (error || !data) return null;
    return data as HeavyStats;
  } catch {
    return null;
  }
}

// Recomputes everything from scratch, only when fetchCachedShowStats()
// came back empty/stale (see app/stats/shows.tsx). Two halves: the charts,
// totals and top lists come straight from Supabase (watched_episodes,
// user_shows, user_movies) and are handed to `onPartial` as soon as they're
// ready — with `previous`'s genre/remaining numbers kept meanwhile — so the
// screen never waits on the slow half. That half (genres, remaining and
// not-started episodes/minutes) is one Postgres call over the shared
// TVmaze cache; only shows missing from that cache are fetched here, one
// by one. It used to be one TVmaze episode list per followed show, here,
// for every followed show — minutes of spinner on an account with
// hundreds of them.
export async function computeShowStats(
  onPartial?: (partial: ShowStats) => void,
  previous?: ShowStats | null,
): Promise<ShowStats> {
  const heavyPromise = fetchHeavyStats();
  const moviePromise = computeMovieStats(new Date());
  const [shows, watched] = await Promise.all([fetchUserShows(), fetchAllWatchedEpisodes()]);

  const today = new Date();
  const buckets: WeekBucket[] = [];
  for (let i = WEEK_COUNT - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i * 7);
    buckets.push({ weekStart: weekStartOf(d.toISOString()), count: 0 });
  }
  const bucketIndex = new Map(buckets.map((b, i) => [b.weekStart, i]));

  const monthBuckets: MonthBucket[] = [];
  for (let i = MONTH_COUNT - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    monthBuckets.push({ monthStart: monthStartOf(d.toISOString()), count: 0 });
  }
  const monthBucketIndex = new Map(monthBuckets.map((b, i) => [b.monthStart, i]));

  const watchedCountByShow = new Map<number, number>();
  const watchedEpisodeIds = new Set(watched.map((w) => w.tvmaze_episode_id));
  // Show id + calendar day -> that show/day's raw watched_at timestamps, for
  // the "most binge-watched" ranking below — a real binge session (a dozen
  // episodes in one sitting) should outrank a show watched at a slow steady
  // drip for years just because the lifetime total is higher. Collected as
  // timestamps rather than a running count so realBingeCount (lib/dates.ts)
  // can filter out same-day rows that are actually one bulk "mark watched"
  // action (all near-identical timestamps — see setEpisodesWatched in
  // lib/userShows.ts) rather than a genuine multi-episode sitting.
  const dailyTimestampsByShow = new Map<string, string[]>();
  for (const ep of watched) {
    watchedCountByShow.set(ep.tvmaze_show_id, (watchedCountByShow.get(ep.tvmaze_show_id) ?? 0) + 1);
    const dayKey = `${ep.tvmaze_show_id}:${ep.watched_at.slice(0, 10)}`;
    const list = dailyTimestampsByShow.get(dayKey);
    if (list) list.push(ep.watched_at);
    else dailyTimestampsByShow.set(dayKey, [ep.watched_at]);
    const weekKey = weekStartOf(ep.watched_at);
    const weekIdx = bucketIndex.get(weekKey);
    if (weekIdx != null) buckets[weekIdx].count += 1;
    const monthKey = monthStartOf(ep.watched_at);
    const monthIdx = monthBucketIndex.get(monthKey);
    if (monthIdx != null) monthBuckets[monthIdx].count += 1;
  }
  const maxDailyByShow = new Map<number, number>();
  for (const [key, timestamps] of dailyTimestampsByShow) {
    const showId = Number(key.split(":")[0]);
    const count = realBingeCount(timestamps);
    maxDailyByShow.set(showId, Math.max(maxDailyByShow.get(showId) ?? 0, count));
  }
  const averagePerWeek = buckets.reduce((sum, b) => sum + b.count, 0) / WEEK_COUNT;
  const averagePerMonth = monthBuckets.reduce((sum, b) => sum + b.count, 0) / MONTH_COUNT;
  const totalEpisodesWatched = watched.length;

  // Counted per show, not per episode: a genre's number is how many distinct
  // shows you've watched at least one episode of that carry that genre, not
  // how many episodes. Only counts shows with actual watch history, so
  // browsing/adding a show without watching it doesn't skew this.
  const showsWithHistory = shows.filter((s) => (watchedCountByShow.get(s.tvmaze_id) ?? 0) > 0);
  const watchingShows = shows.filter((s) => s.status === "watching");
  // Mirrors the Shows tab's own "Not started" definition exactly (see
  // computeEnrichedForShow in app/(tabs)/index.tsx): any followed show —
  // "watching" or "want_to_watch" — with zero watch history yet, not just
  // ones explicitly parked as "want to watch". A show you just added and
  // haven't pressed play on yet is still "watching" status-wise.
  const notStartedShows = shows.filter(
    (s) => (s.status === "watching" || s.status === "want_to_watch") && (watchedCountByShow.get(s.tvmaze_id) ?? 0) === 0
  );
  const todayIso = todayISODate();

  // Most binge-watched shows — ranked by the most episodes watched of that
  // show in a single day (a real binge session), not lifetime total, so a
  // show watched steadily for years doesn't outrank one you tore through in
  // a weekend. episodeCount here is that single-day peak, not a total.
  // Names/posters come from the user's own list rather than a TVmaze call
  // per show.
  const showRowById = new Map(shows.map((s) => [s.tvmaze_id, s]));
  const topShows: TopShow[] = [...maxDailyByShow.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([showId, episodeCount]) => ({
      showId,
      name: showRowById.get(showId)?.show_name ?? peekCachedShow(showId)?.name ?? `#${showId}`,
      image: showRowById.get(showId)?.show_image ?? peekCachedShow(showId)?.image?.medium ?? null,
      episodeCount,
    }));

  const { totalMoviesWatched, moviesPerMonth, averageMoviesPerMonth, topMovies } = await moviePromise;

  const base = {
    schemaVersion: STATS_SCHEMA_VERSION,
    episodesPerWeek: buckets,
    averagePerWeek,
    episodesPerMonth: monthBuckets,
    averagePerMonth,
    totalEpisodesWatched,
    topShows,
    totalMoviesWatched,
    moviesPerMonth,
    averageMoviesPerMonth,
    topMovies,
    computedAt: new Date().toISOString(),
  };
  onPartial?.({
    ...base,
    remainingEpisodes: previous?.remainingEpisodes ?? 0,
    notStartedEpisodes: previous?.notStartedEpisodes ?? 0,
    remainingMinutes: previous?.remainingMinutes ?? 0,
    notStartedMinutes: previous?.notStartedMinutes ?? 0,
    genreBreakdown: previous?.genreBreakdown ?? [],
  });

  const heavy = await heavyPromise;
  const genreTotals = new Map<string, number>((heavy?.genres ?? []).map((g) => [g.genre, g.count]));
  let remainingEpisodes = heavy?.remaining_episodes ?? 0;
  let notStartedEpisodes = heavy?.not_started_episodes ?? 0;
  let remainingMinutes = heavy?.remaining_minutes ?? 0;
  let notStartedMinutes = heavy?.not_started_minutes ?? 0;

  // Whatever the server couldn't cover — everything, if the call failed.
  const missingEpisodeIds = heavy ? new Set(heavy.missing_episodes) : null;
  const missingShowIds = heavy ? new Set(heavy.missing_shows) : null;
  const historyToFetch = showsWithHistory.filter((s) => !missingShowIds || missingShowIds.has(s.tvmaze_id));
  const watchingToFetch = watchingShows.filter((s) => !missingEpisodeIds || missingEpisodeIds.has(s.tvmaze_id));
  const notStartedToFetch = notStartedShows.filter((s) => !missingEpisodeIds || missingEpisodeIds.has(s.tvmaze_id));

  await mapWithConcurrency(historyToFetch, STATS_FETCH_CONCURRENCY, async (show) => {
    try {
      const info = await getCachedShow(show.tvmaze_id, () => getShow(show.tvmaze_id));
      for (const genre of info.genres) genreTotals.set(genre, (genreTotals.get(genre) ?? 0) + 1);
    } catch {
      // Show metadata unavailable — skip it for the genre breakdown.
    }
  });

  await mapWithConcurrency(watchingToFetch, STATS_FETCH_CONCURRENCY, async (show) => {
    try {
      const episodes = await getCachedEpisodes(show.tvmaze_id, () => getShowEpisodes(show.tvmaze_id));
      const aired = episodes.filter((e) => e.airdate && e.airdate <= todayIso);
      remainingEpisodes += Math.max(0, aired.length - (watchedCountByShow.get(show.tvmaze_id) ?? 0));
      // By episode id rather than the count above — the minutes need to
      // be the actual unwatched episodes' own runtimes.
      remainingMinutes += totalRuntime(
        aired.filter((e) => !watchedEpisodeIds.has(e.id)),
        averageRuntime(episodes),
      );
    } catch {
      // Episode list unavailable — skip this show's remaining count.
    }
  });

  await mapWithConcurrency(notStartedToFetch, STATS_FETCH_CONCURRENCY, async (show) => {
    try {
      const episodes = await getCachedEpisodes(show.tvmaze_id, () => getShowEpisodes(show.tvmaze_id));
      const aired = episodes.filter((e) => e.airdate && e.airdate <= todayIso);
      notStartedEpisodes += aired.length;
      notStartedMinutes += totalRuntime(aired, averageRuntime(episodes));
    } catch {
      // Episode list unavailable — skip this show's count.
    }
  });

  const genreBreakdown = [...genreTotals.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    ...base,
    remainingEpisodes,
    notStartedEpisodes,
    remainingMinutes,
    notStartedMinutes,
    genreBreakdown,
  };
}

async function computeMovieStats(today: Date): Promise<{
  totalMoviesWatched: number;
  moviesPerMonth: MonthBucket[];
  averageMoviesPerMonth: number;
  topMovies: TopMovie[];
}> {
  const userId = await getCurrentUserId();
  if (!userId) {
    return { totalMoviesWatched: 0, moviesPerMonth: [], averageMoviesPerMonth: 0, topMovies: [] };
  }

  const { data, error } = await supabase
    .from("user_movies")
    .select("id, title, year, poster_path, times_watched, watched_at")
    .eq("user_id", userId)
    .eq("status", "watched");
  if (error) throw error;
  const movies = data ?? [];

  const monthBuckets: MonthBucket[] = [];
  for (let i = MONTH_COUNT - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    monthBuckets.push({ monthStart: monthStartOf(d.toISOString()), count: 0 });
  }
  const monthBucketIndex = new Map(monthBuckets.map((b, i) => [b.monthStart, i]));
  for (const m of movies) {
    if (!m.watched_at) continue;
    const idx = monthBucketIndex.get(monthStartOf(m.watched_at));
    if (idx != null) monthBuckets[idx].count += 1;
  }
  const averageMoviesPerMonth = monthBuckets.reduce((sum, b) => sum + b.count, 0) / MONTH_COUNT;

  const topMovies: TopMovie[] = [...movies]
    .sort((a, b) => b.times_watched - a.times_watched)
    .slice(0, 5)
    .map((m) => ({ movieId: m.id, title: m.title, year: m.year, posterPath: m.poster_path, timesWatched: m.times_watched }));

  return { totalMoviesWatched: movies.length, moviesPerMonth: monthBuckets, averageMoviesPerMonth, topMovies };
}

// Instant, no-network read for the very first paint of app/stats/shows.tsx —
// call this before fetchCachedShowStats() below, which still hits Supabase.
// Same schemaVersion guard as the Supabase row, so a shape from an older
// build of the app doesn't reach the UI here either.
export async function loadLocalShowStats(): Promise<ShowStats | null> {
  try {
    const raw = await localStatsStore.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const stats = JSON.parse(raw) as ShowStats;
    if (stats.schemaVersion !== STATS_SCHEMA_VERSION) return null;
    return stats;
  } catch {
    return null;
  }
}

async function saveLocalShowStats(stats: ShowStats): Promise<void> {
  try {
    await localStatsStore.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Best-effort — worst case the next visit re-reads from Supabase instead
    // of painting instantly from disk.
  }
}

// Called on sign-out (see context/AuthContext.tsx) — this key has no user id
// in it, so without clearing it, signing into a different account on the
// same device would briefly show the previous account's stats straight from
// disk before the fresh Supabase fetch overwrites it.
export async function clearLocalShowStats(): Promise<void> {
  try {
    await localStatsStore.removeItem(LOCAL_STORAGE_KEY);
  } catch {
    // Best-effort.
  }
}

export async function fetchCachedShowStats(): Promise<ShowStats | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from("show_stats_cache")
    .select("payload, computed_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const payload = data.payload as ShowStats;
  if (payload.schemaVersion !== STATS_SCHEMA_VERSION) return null;
  const stats = { ...payload, computedAt: data.computed_at };
  saveLocalShowStats(stats);
  return stats;
}

export async function saveShowStats(stats: ShowStats): Promise<void> {
  saveLocalShowStats(stats);

  const userId = await getCurrentUserId();
  if (!userId) return;

  const { error } = await supabase
    .from("show_stats_cache")
    .upsert({ user_id: userId, payload: stats, computed_at: stats.computedAt }, { onConflict: "user_id" });
  if (error) throw error;
}
