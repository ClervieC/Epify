import AsyncStorage, { createAsyncStorage } from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { supabase, getCurrentUserId } from "./supabase";
import { fetchUserShows, UserShow } from "./userShows";
import { fetchUserMovies, UserMovie } from "./userMovies";
import { fetchFollowingIds } from "./follows";
import { getCachedShow } from "./showDataCache";
import { getCachedMovieGenres, getMovieDetails } from "./tmdb";
import { getShow } from "./tvmaze";
import { mapWithConcurrency } from "./concurrency";
import { realBingeCount } from "./dates";
import type { Colors } from "./theme";
import type { Translations } from "./i18n";

const PAGE_SIZE = 1000;
const GENRE_FETCH_CONCURRENCY = 6;

// IndexedDB-backed local mirror (see the same comment in lib/showStats.ts)
// — paints app/streaks.tsx and the Shows tab's streak pill instantly from
// the last computed result, no network round trip, while a fresh compute
// runs in the background. This has no Supabase-side counterpart the way
// show_stats_cache does: streak/badge data is cheap enough to recompute
// (one watched_at scan, a handful of counts) that a per-device cache is
// all it needs — nothing here is expensive enough to justify syncing a
// precomputed copy across devices too.
const localStore = createAsyncStorage("streaks_cache");
const LOCAL_STORAGE_KEY = "streaks_v1";
const SCHEMA_VERSION = 8;

export type BadgeCategory =
  | "episodes"
  | "movies"
  | "shows"
  | "streak"
  | "ratings"
  | "reactions"
  | "social"
  | "rewatch"
  | "genre"
  | "binge";

export interface Badge {
  id: string;
  category: BadgeCategory;
  threshold: number;
  achieved: boolean;
  // The moment this device/session first noticed the badge achieved (see
  // syncBadgeUnlocks below) — null while locked, or for an achieved badge
  // whose unlock row hasn't synced yet (e.g. offline).
  earnedAt: string | null;
  // The category's current raw metric value (e.g. totalEpisodesWatched for
  // every "episodes" badge) — same number on every badge in a category,
  // repeated per-badge so app/streaks.tsx can render a "12/50" progress bar
  // on the next locked badge without needing the category totals separately.
  progress: number;
  // Only set for category "genre" — which curated genre (see GENRE_DEFS)
  // this particular badge tracks. badgeLabel/badgeIcon below key off this
  // instead of the shared per-category label/icon every other category uses.
  genre?: string;
}

// Curated rather than derived from whatever raw genre strings TVmaze/TMDB
// happen to return (which don't even agree with each other — TVmaze says
// "Science-Fiction", TMDB's TV genre is "Sci-Fi & Fantasy") — `match` is the
// set of raw strings (checked case-insensitively, substring) that count
// toward this genre's badge. Order here is display order in the "Genres"
// category.
export const GENRE_DEFS: { key: string; match: string[]; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "comedy", match: ["comedy"], icon: "happy-outline" },
  { key: "drama", match: ["drama"], icon: "sad-outline" },
  { key: "romance", match: ["romance"], icon: "heart-outline" },
  { key: "action", match: ["action"], icon: "flash-outline" },
  { key: "scifi", match: ["science-fiction", "science fiction", "sci-fi"], icon: "planet-outline" },
  { key: "fantasy", match: ["fantasy"], icon: "sparkles-outline" },
  { key: "crime", match: ["crime"], icon: "shield-outline" },
  { key: "horror", match: ["horror"], icon: "skull-outline" },
  { key: "animation", match: ["animation", "anime"], icon: "color-palette-outline" },
];
const GENRE_THRESHOLDS = [1, 5, 15];

export interface StreakData {
  schemaVersion: number;
  currentStreak: number;
  longestStreak: number;
  // True when currentStreak > 0 but nothing's been watched yet today (UTC
  // calendar day, same boundary computeStreaks itself uses) — the streak is
  // still technically alive (see computeStreaks' comment) but breaks at the
  // next UTC midnight if it stays this way. Drives the "streak in danger"
  // nudge (Shows tab pill, Profile banner, app/streaks.tsx).
  streakAtRisk: boolean;
  totalEpisodesWatched: number;
  totalMoviesWatched: number;
  showsCompleted: number;
  badges: Badge[];
  computedAt: string;
}

// Shared between app/streaks.tsx and the badge-unlock toast (see
// context/BadgeUnlockContext.tsx) so both render the exact same icon/color/
// label per badge instead of keeping two copies in sync by hand.
export const BADGE_ICON: Record<BadgeCategory, keyof typeof Ionicons.glyphMap> = {
  episodes: "checkmark-done-outline",
  movies: "film-outline",
  shows: "ribbon-outline",
  streak: "flame-outline",
  ratings: "star-outline",
  reactions: "thumbs-up-outline",
  social: "people-outline",
  rewatch: "repeat-outline",
  genre: "pricetag-outline",
  binge: "flash-outline",
};

// Genre badges each have their own icon (see GENRE_DEFS) instead of one
// shared per-category glyph — use this instead of indexing BADGE_ICON
// directly so callers don't have to special-case category "genre".
export function badgeIcon(badge: Badge): keyof typeof Ionicons.glyphMap {
  if (badge.category === "genre") {
    return GENRE_DEFS.find((g) => g.key === badge.genre)?.icon ?? BADGE_ICON.genre;
  }
  return BADGE_ICON[badge.category];
}

// One accent color per category so the badge grid (and the unlock toast)
// read as distinct collections rather than one undifferentiated wall of
// purple.
export function categoryColor(colors: Colors, category: BadgeCategory): string {
  const map: Record<BadgeCategory, string> = {
    episodes: colors.blue,
    movies: colors.red,
    shows: colors.yellow,
    streak: "#ff9f43",
    ratings: colors.accent,
    reactions: "#0ca678",
    social: colors.green,
    rewatch: colors.blue,
    genre: "#d6336c",
    binge: "#7048e8",
  };
  return map[category];
}

export function badgeLabel(t: Translations, badge: Badge): string {
  if (badge.category === "genre") {
    const genreName = t.profile.genreNames[badge.genre as keyof Translations["profile"]["genreNames"]];
    return t.profile.badgeGenre(genreName, badge.threshold);
  }
  const BADGE_LABEL: Record<Exclude<BadgeCategory, "genre">, (n: number) => string> = {
    episodes: t.profile.badgeEpisodes,
    movies: t.profile.badgeMovies,
    shows: t.profile.badgeShows,
    streak: t.profile.badgeStreak,
    ratings: t.profile.badgeRatings,
    reactions: t.profile.badgeReactions,
    social: t.profile.badgeSocial,
    rewatch: t.profile.badgeRewatch,
    binge: t.profile.badgeBinge,
  };
  return BADGE_LABEL[badge.category](badge.threshold);
}

const EPISODE_THRESHOLDS = [10, 50, 100, 500, 1000];
const MOVIE_THRESHOLDS = [5, 25, 50, 100];
const SHOW_THRESHOLDS = [1, 5, 10, 25];
const STREAK_THRESHOLDS = [3, 7, 30, 100];
const RATINGS_THRESHOLDS = [5, 25, 100, 250];
const REACTIONS_THRESHOLDS = [5, 25, 100, 250];
const SOCIAL_THRESHOLDS = [1, 5, 10, 25];
const REWATCH_THRESHOLDS = [1, 5, 15, 50];
// Episodes of one single show watched in one calendar day — 3 is a light
// binge, 20 is a real marathon. Same "one show, one day" metric as
// lib/showStats.ts's topShows ranking (see fetchWatchedDays' comment above).
const BINGE_THRESHOLDS = [3, 5, 10, 20];

// Also tallies the single biggest "one show, one day" episode count across
// the user's whole history (maxDailyShowEpisodes) — the same "binge day"
// metric lib/showStats.ts's topShows already ranks shows by, just reduced
// to one number here for the "binge" badge category (see buildBadges). Rides
// along on this function's existing full watched_episodes scan rather than
// adding a second one — this already runs on every computeStreakData() call
// (including the fire-and-forget check after every single watch action, see
// lib/badgeNotify.ts), so a duplicate scan just for this would double that
// cost for no reason.
async function fetchWatchedDays(): Promise<{ days: Set<string>; maxDailyShowEpisodes: number }> {
  const userId = await getCurrentUserId();
  const days = new Set<string>();
  if (!userId) return { days, maxDailyShowEpisodes: 0 };

  // Timestamps, not a running count — a bulk "mark all previous episodes
  // watched" (or a season/import bulk-write) puts many rows on the same
  // calendar day with near-identical watched_at values, which isn't a real
  // binge session. realBingeCount (lib/dates.ts) collapses a cluster like
  // that down to 1, only counting timestamps genuinely spaced apart, so
  // this badge tracks actual sequential viewing, not bulk catch-up marking.
  const dailyShowTimestamps = new Map<string, string[]>();
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("watched_episodes")
      .select("watched_at, tvmaze_show_id")
      .eq("user_id", userId)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    for (const row of page) {
      if (!row.watched_at) continue;
      const dayKey = row.watched_at.slice(0, 10);
      days.add(dayKey);
      const showDayKey = `${row.tvmaze_show_id}:${dayKey}`;
      const list = dailyShowTimestamps.get(showDayKey);
      if (list) list.push(row.watched_at);
      else dailyShowTimestamps.set(showDayKey, [row.watched_at]);
    }
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  let maxDailyShowEpisodes = 0;
  for (const timestamps of dailyShowTimestamps.values()) {
    const count = realBingeCount(timestamps);
    if (count > maxDailyShowEpisodes) maxDailyShowEpisodes = count;
  }

  const { data: movieRows, error: movieError } = await supabase
    .from("user_movies")
    .select("watched_at")
    .eq("user_id", userId)
    .eq("status", "watched");
  if (movieError) throw movieError;
  for (const row of movieRows ?? []) {
    if (row.watched_at) days.add(row.watched_at.slice(0, 10));
  }

  return { days, maxDailyShowEpisodes };
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Longest run of consecutive calendar days with at least one watch, and the
// current run — which stays "alive" through today even if today itself has
// no activity yet (same forgiving semantics as Duolingo/GitHub streaks: the
// streak only actually breaks once a full day passes with nothing watched).
function computeStreaks(days: Set<string>): { current: number; longest: number; atRisk: boolean } {
  if (days.size === 0) return { current: 0, longest: 0, atRisk: false };

  let longest = 0;
  let run = 0;
  const sorted = [...days].sort();
  let prev: Date | null = null;
  for (const key of sorted) {
    const d = new Date(key + "T00:00:00Z");
    if (prev) {
      const diffDays = Math.round((d.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000));
      run = diffDays === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    prev = d;
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayCounted = days.has(toDateKey(today));
  const cursor = new Date(today);
  if (!todayCounted) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  let current = 0;
  while (days.has(toDateKey(cursor))) {
    current += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return { current, longest, atRisk: current > 0 && !todayCounted };
}

function buildBadges(
  totalEpisodesWatched: number,
  totalMoviesWatched: number,
  showsCompleted: number,
  longestStreak: number,
  ratingsGiven: number,
  reactionsGiven: number,
  followingCount: number,
  rewatchCount: number,
  genreCounts: Record<string, number>,
  maxDailyShowEpisodes: number
): Badge[] {
  const badges: Badge[] = [];
  for (const threshold of EPISODE_THRESHOLDS) {
    badges.push({ id: `episodes-${threshold}`, category: "episodes", threshold, achieved: totalEpisodesWatched >= threshold, earnedAt: null, progress: totalEpisodesWatched });
  }
  for (const threshold of MOVIE_THRESHOLDS) {
    badges.push({ id: `movies-${threshold}`, category: "movies", threshold, achieved: totalMoviesWatched >= threshold, earnedAt: null, progress: totalMoviesWatched });
  }
  for (const threshold of SHOW_THRESHOLDS) {
    badges.push({ id: `shows-${threshold}`, category: "shows", threshold, achieved: showsCompleted >= threshold, earnedAt: null, progress: showsCompleted });
  }
  for (const threshold of STREAK_THRESHOLDS) {
    badges.push({ id: `streak-${threshold}`, category: "streak", threshold, achieved: longestStreak >= threshold, earnedAt: null, progress: longestStreak });
  }
  for (const threshold of RATINGS_THRESHOLDS) {
    badges.push({ id: `ratings-${threshold}`, category: "ratings", threshold, achieved: ratingsGiven >= threshold, earnedAt: null, progress: ratingsGiven });
  }
  for (const threshold of REACTIONS_THRESHOLDS) {
    badges.push({ id: `reactions-${threshold}`, category: "reactions", threshold, achieved: reactionsGiven >= threshold, earnedAt: null, progress: reactionsGiven });
  }
  for (const threshold of SOCIAL_THRESHOLDS) {
    badges.push({ id: `social-${threshold}`, category: "social", threshold, achieved: followingCount >= threshold, earnedAt: null, progress: followingCount });
  }
  for (const threshold of REWATCH_THRESHOLDS) {
    badges.push({ id: `rewatch-${threshold}`, category: "rewatch", threshold, achieved: rewatchCount >= threshold, earnedAt: null, progress: rewatchCount });
  }
  for (const { key } of GENRE_DEFS) {
    const count = genreCounts[key] ?? 0;
    for (const threshold of GENRE_THRESHOLDS) {
      badges.push({ id: `genre-${key}-${threshold}`, category: "genre", genre: key, threshold, achieved: count >= threshold, earnedAt: null, progress: count });
    }
  }
  for (const threshold of BINGE_THRESHOLDS) {
    badges.push({ id: `binge-${threshold}`, category: "binge", threshold, achieved: maxDailyShowEpisodes >= threshold, earnedAt: null, progress: maxDailyShowEpisodes });
  }
  return badges;
}

// Tallies completed shows (status "watched") and watched movies per curated
// genre — the same "counted per title, not per episode" rule
// lib/showStats.ts's genreBreakdown uses for shows, restricted to shows
// actually finished rather than merely started, to mirror the existing
// "shows" badge category's own definition of done. Movies have no
// in-progress state (see lib/userMovies.ts's MovieStatus), so every watched
// one counts.
//
// Network-free by default: both getCachedShow and getCachedMovieGenres only
// ever read what's already on disk (the former via a fetcher that
// immediately rejects, the latter by construction), so a title only counts
// if its info was already cached on this device (warmed by
// lib/backgroundPrefetch.ts, or just from having opened it) — otherwise
// it's silently skipped. That keeps this safe to run on every
// computeStreakData() call (including the Shows tab's per-visit streak pill)
// instead of adding a real network round trip to a hot path.
//
// useNetwork opts into real TVmaze/TMDB fetches for anything not already
// cached — used exactly once per account (see runGenreBadgeBackfillIfNeeded
// below) right after the genre badge category shipped, so existing users'
// full history gets scanned for real instead of only whatever happened to
// already be cached on that one device. Every call after that first one
// goes back to the cheap cache-only path above.
async function computeGenreCounts(
  completedShows: UserShow[],
  watchedMovies: UserMovie[],
  useNetwork: boolean = false
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  function tally(genres: string[]) {
    const lower = genres.map((g) => g.toLowerCase());
    for (const { key, match } of GENRE_DEFS) {
      if (lower.some((g) => match.some((m) => g.includes(m)))) {
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
  }

  await mapWithConcurrency(completedShows, GENRE_FETCH_CONCURRENCY, async (show) => {
    try {
      const info = await getCachedShow(
        show.tvmaze_id,
        useNetwork ? () => getShow(show.tvmaze_id) : () => Promise.reject(new Error("no-network"))
      );
      tally(info.genres);
    } catch {
      // Not cached (and not backfilling, or the network fetch itself
      // failed) — skip, see comment above.
    }
  });

  await mapWithConcurrency(
    watchedMovies.filter((m) => m.tmdb_id != null),
    GENRE_FETCH_CONCURRENCY,
    async (movie) => {
      let genres = await getCachedMovieGenres(movie.tmdb_id!);
      if (!genres && useNetwork) {
        try {
          genres = (await getMovieDetails(movie.tmdb_id!)).genres.map((g) => g.name);
        } catch {
          // Network fetch failed — leave uncounted, same as a cache miss.
        }
      }
      if (genres) tally(genres);
    }
  );

  return counts;
}

// One-time-per-account flag so the heavier, network-aware genre pass above
// only ever runs once per account (not once per device — a different device
// signing into the same account still needs its own real pass, since the
// cache it'd otherwise rely on lives per-device) rather than on every
// Profile visit. Plain AsyncStorage (not the IndexedDB-backed
// createAsyncStorage used for localStore above) — same reasoning as
// lib/onboarding.ts: a single small flag, not a cache worth its own
// database.
function genreBackfillKey(userId: string): string {
  return `genre_badges_backfilled_v1:${userId}`;
}

// Call once from wherever badges are actually visible (see app/(tabs)/
// profile.tsx) — runs the real network-aware compute exactly once per
// account/device pair, then marks it done so every later visit goes back to
// the normal cheap computeStreakData() call.
export async function runGenreBadgeBackfillIfNeeded(
  onNewlyUnlocked?: (badges: Badge[]) => void
): Promise<StreakData | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;
  try {
    if ((await AsyncStorage.getItem(genreBackfillKey(userId))) === "true") return null;
  } catch {
    return null; // Can't confirm it's needed — safer to skip than to re-run this on every visit.
  }
  const data = await computeStreakData(onNewlyUnlocked, true);
  await AsyncStorage.setItem(genreBackfillKey(userId), "true").catch(() => {});
  return data;
}

async function countRows(table: string, userId: string, extra?: (q: any) => any): Promise<number> {
  let q = supabase.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (extra) q = extra(q);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

// Mutates badges in place, filling in earnedAt for any achieved badge — reads
// this user's existing public.badge_unlocks rows, inserts a fresh row (now())
// for any achieved badge that doesn't have one yet, and leaves earnedAt null
// for anything still locked. Best-effort: a failure here (e.g. offline, or
// the migration hasn't been run yet — see supabase/schema.sql) just leaves
// every earnedAt null rather than breaking the rest of the streak compute.
//
// Returns the badges that are genuinely newly earned (for a celebratory
// banner — see computeStreakData's onNewlyUnlocked) — but only when this
// user already had at least one badge_unlocks row. Without that guard, the
// very first compute after this table existed would insert a row for every
// already-achieved badge in one go and report all of them as "just earned,"
// flooding a long-time user with a banner for a dozen badges they actually
// earned months ago.
async function syncBadgeUnlocks(userId: string, badges: Badge[]): Promise<Badge[]> {
  try {
    const { data, error } = await supabase
      .from("badge_unlocks")
      .select("badge_id, earned_at")
      .eq("user_id", userId);
    if (error) throw error;
    const existing = new Map((data ?? []).map((r) => [r.badge_id, r.earned_at as string]));
    const isBackfill = existing.size === 0;

    const toInsert: Badge[] = [];
    for (const badge of badges) {
      if (!badge.achieved) continue;
      const earnedAt = existing.get(badge.id);
      if (earnedAt) {
        badge.earnedAt = earnedAt;
      } else {
        toInsert.push(badge);
      }
    }
    if (toInsert.length === 0) return [];

    const now = new Date().toISOString();
    const { error: insertError } = await supabase.from("badge_unlocks").upsert(
      toInsert.map((badge) => ({ user_id: userId, badge_id: badge.id, earned_at: now })),
      { onConflict: "user_id,badge_id", ignoreDuplicates: true }
    );
    if (insertError) throw insertError;
    for (const badge of toInsert) badge.earnedAt = now;
    return isBackfill ? [] : toInsert;
  } catch {
    // Best-effort — see comment above.
    return [];
  }
}

// Device-local (not synced through Supabase, unlike badge_unlocks itself) —
// "we already told you you're 1 away from this badge" is a nice-to-have
// nudge, not data worth a table/RLS policy over. Plain AsyncStorage, same
// convention as the genre backfill flag above: a small JSON array, not a
// cache. Never cleared once a badge is added, even if progress later dips
// back below the threshold (e.g. an unwatch) — the point was made once,
// re-nagging about it later would be annoying rather than motivating.
function almostUnlockedKey(userId: string): string {
  return `almost_unlocked_notified_v1:${userId}`;
}

async function loadAlmostNotifiedIds(userId: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(almostUnlockedKey(userId));
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

// Badges exactly one watch/rating/rewatch/follow away from unlocking (see
// Badge.progress/threshold) that haven't already surfaced the "almost
// there" toast (see context/BadgeUnlockContext.tsx) on this device. Exactly
// one, not "close," so this only ever nudges about the single next action
// that would actually unlock something — thresholds within a category are
// spread far enough apart (see BadgeCategory's threshold arrays) that at
// most one badge per category can be exactly 1 away at a time.
async function getNewlyAlmostUnlocked(userId: string, badges: Badge[]): Promise<Badge[]> {
  const candidates = badges.filter((b) => !b.achieved && b.threshold - b.progress === 1);
  if (candidates.length === 0) return [];

  const alreadyNotified = await loadAlmostNotifiedIds(userId);
  const fresh = candidates.filter((b) => !alreadyNotified.has(b.id));
  if (fresh.length === 0) return [];

  for (const b of fresh) alreadyNotified.add(b.id);
  await AsyncStorage.setItem(almostUnlockedKey(userId), JSON.stringify([...alreadyNotified])).catch(() => {});
  return fresh;
}

// Not cached server-side the way lib/showStats.ts's heavier stats are — this
// only needs one lightweight watched_at scan, a handful of counts, and a
// network-free disk-cache-only genre lookup (see computeGenreCounts), cheap
// enough to recompute on every visit. Still mirrored into IndexedDB (see
// loadLocalStreakData/saveLocalStreakData below) purely for an instant first
// paint / offline read, same pattern as showStats's local cache.
export async function computeStreakData(
  onNewlyUnlocked?: (badges: Badge[]) => void,
  useNetworkForGenres: boolean = false,
  onAlmostUnlocked?: (badges: Badge[]) => void
): Promise<StreakData> {
  const userId = await getCurrentUserId();

  // All independent of each other — running them concurrently instead of
  // one after another is most of the win here (six count queries plus the
  // watched-days scan were previously six-plus sequential round trips).
  const [{ days, maxDailyShowEpisodes }, shows, watchedMovies, followingIds, totalEpisodesWatched, ratedEpisodes, reactedEpisodes, rewatchedEpisodesCount, rewatchedMoviesCount] =
    await Promise.all([
      fetchWatchedDays(),
      fetchUserShows(),
      fetchUserMovies(),
      userId ? fetchFollowingIds(userId) : Promise.resolve([]),
      userId ? countRows("watched_episodes", userId) : Promise.resolve(0),
      userId ? countRows("watched_episodes", userId, (q) => q.not("rating", "is", null)) : Promise.resolve(0),
      userId ? countRows("watched_episodes", userId, (q) => q.not("feeling", "is", null)) : Promise.resolve(0),
      userId ? countRows("watched_episodes", userId, (q) => q.gt("times_watched", 1)) : Promise.resolve(0),
      userId ? countRows("user_movies", userId, (q) => q.eq("status", "watched").gt("times_watched", 1)) : Promise.resolve(0),
    ]);
  const { current, longest, atRisk } = computeStreaks(days);

  const showsCompleted = shows.filter((s) => s.status === "watched").length;
  const totalMoviesWatched = watchedMovies.length;
  // Rating/reacting to a show overall (user_shows.rating/feeling, set via
  // rateShow — see app/show/[id].tsx) is a distinct act from rating/reacting
  // to one of its episodes, so it counts too; `shows`/`watchedMovies` are
  // already fetched above, no extra round trips needed.
  const ratedShows = shows.filter((s) => s.rating !== null).length;
  const reactedShows = shows.filter((s) => s.feeling !== null).length;
  const ratedMovies = watchedMovies.filter((m) => m.rating !== null).length;
  const reactedMovies = watchedMovies.filter((m) => m.feeling !== null).length;
  const ratingsGiven = ratedEpisodes + ratedMovies + ratedShows;
  // Separate from ratingsGiven above — a "feeling" (the quick emoji reaction
  // prompt, see components/FeelingSheet.tsx) is a different act from giving a
  // star rating, and a user can do either without the other, so this badge
  // category tracks its own `feeling` column instead of piggybacking on
  // `rating`'s not-null count.
  const reactionsGiven = reactedEpisodes + reactedMovies + reactedShows;
  const rewatchCount = rewatchedEpisodesCount + rewatchedMoviesCount;
  const genreCounts = await computeGenreCounts(
    shows.filter((s) => s.status === "watched"),
    watchedMovies,
    useNetworkForGenres
  );

  const badges = buildBadges(
    totalEpisodesWatched,
    totalMoviesWatched,
    showsCompleted,
    longest,
    ratingsGiven,
    reactionsGiven,
    followingIds.length,
    rewatchCount,
    genreCounts,
    maxDailyShowEpisodes
  );
  if (userId) {
    const newlyUnlocked = await syncBadgeUnlocks(userId, badges);
    if (newlyUnlocked.length > 0) onNewlyUnlocked?.(newlyUnlocked);
    if (onAlmostUnlocked) {
      const almost = await getNewlyAlmostUnlocked(userId, badges);
      if (almost.length > 0) onAlmostUnlocked(almost);
    }
  }

  const data: StreakData = {
    schemaVersion: SCHEMA_VERSION,
    currentStreak: current,
    longestStreak: longest,
    streakAtRisk: atRisk,
    totalEpisodesWatched,
    totalMoviesWatched,
    showsCompleted,
    badges,
    computedAt: new Date().toISOString(),
  };
  saveLocalStreakData(data);
  return data;
}

// Instant, no-network read — call before computeStreakData() for a fast
// first paint (see app/streaks.tsx and the Shows tab's streak pill).
export async function loadLocalStreakData(): Promise<StreakData | null> {
  try {
    const raw = await localStore.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as StreakData;
    if (data.schemaVersion !== SCHEMA_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

async function saveLocalStreakData(data: StreakData): Promise<void> {
  try {
    await localStore.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Best-effort.
  }
}

// Called on sign-out (see context/AuthContext.tsx) — this key has no user id
// in it, so without clearing it, signing into a different account on the
// same device would briefly show the previous account's streak/badges
// straight from disk before the fresh compute overwrites it.
export async function clearLocalStreakData(): Promise<void> {
  try {
    await localStore.removeItem(LOCAL_STORAGE_KEY);
  } catch {
    // Best-effort.
  }
}
