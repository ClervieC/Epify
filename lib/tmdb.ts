import { createAsyncStorage } from "@react-native-async-storage/async-storage";
import { lookupShowByTvdbId, TVMazeShow, Priority } from "./tvmaze";
import { fetchWithTimeout } from "./fetchTimeout";
import { supabase } from "./supabase";

// See the same comment in lib/tvmaze.ts: the package's default export is a
// legacy singleton backed by window.localStorage on web (~5-10MB, shared
// with everything else stored there, including Supabase's own session
// token) — this cache is unbounded, so on web it contributed to filling
// that shared quota entirely. Its own IndexedDB database avoids that.
const storage = createAsyncStorage("tmdb_cache");

const BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE_URL = "https://image.tmdb.org/t/p";
const API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY;
const CACHE_PREFIX = "tmdb_cache:";
const ONE_DAY = 24 * 60 * 60 * 1000;

const memoryCache = new Map<string, { data: unknown; expiresAt: number }>();

// Same shape as lib/tvmaze.ts's withCache: in-memory for the session,
// persisted to disk across restarts, and falls back to stale data on a
// failed fetch rather than showing an error. Movie metadata never changes
// once published, so a day-long TTL is more than safe.
async function withCache<T>(cacheKey: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = memoryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.data as T;

  const storageKey = CACHE_PREFIX + cacheKey;
  let stalePersisted: T | undefined;
  try {
    const stored = await storage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored) as { data: T; expiresAt: number };
      if (parsed.expiresAt > now) {
        memoryCache.set(cacheKey, parsed);
        return parsed.data;
      }
      stalePersisted = parsed.data;
    }
  } catch {
    // Corrupt/unavailable cache entry — fall through and refetch.
  }

  try {
    const data = await fetcher();
    const entry = { data, expiresAt: now + ttlMs };
    memoryCache.set(cacheKey, entry);
    storage.setItem(storageKey, JSON.stringify(entry)).catch(() => {});
    return data;
  } catch (err) {
    if (stalePersisted !== undefined) return stalePersisted;
    const memoryStale = memoryCache.get(cacheKey);
    if (memoryStale) return memoryStale.data as T;
    throw err;
  }
}

export interface TMDBSearchResult {
  id: number;
  title: string;
  release_date: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
  vote_average: number;
}

export interface TMDBMovieDetails extends TMDBSearchResult {
  runtime: number | null;
  genres: { id: number; name: string }[];
  tagline: string;
}

export interface TMDBCastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
}

// TMDB's own query params only — the shared-cache path/key (see
// fetchViaSharedCache below) is built from this same helper *without* the
// api_key get() adds separately, so the same path is the cache key
// regardless of which layer serves it.
function pathWithQuery(path: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params).toString();
  return query ? `${path}?${query}` : path;
}

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!API_KEY) throw new Error("EXPO_PUBLIC_TMDB_API_KEY is not set");
  const res = await fetchWithTimeout(`${BASE_URL}${pathWithQuery(path, { api_key: API_KEY, ...params })}`);
  if (!res.ok) {
    throw new Error(`TMDB request failed (${res.status}): ${path}`);
  }
  return res.json() as Promise<T>;
}

// The shared cross-user cache (supabase/functions/tmdb-cache, tmdb_api_cache
// in supabase/schema.sql, keyed by the exact TMDB path + query string) sits
// *behind* every local withCache below — a hit here means no TMDB call at
// all, from anyone, ever, until that row's TTL lapses. Unlike TVmaze (rate
// limited per caller IP), TMDB's key is one app-wide shared budget, so this
// matters even more at scale. `{ hit: false }` on any failure (network,
// unauthenticated, function down, whatever) — rather than throwing — means
// a hiccup in that infrastructure never blocks getting movie/show data; it
// just falls straight through to fetching TMDB directly, same as before
// this existed.
//
// Reads tmdb_api_cache directly via PostgREST FIRST, before ever touching
// the tmdb-cache Edge Function — a k6 load test at 100 concurrent users
// found PostgREST holding a ~110ms p95, while routing the exact same
// cache-hit request through the self-hosted Deno edge-runtime instead cost
// a ~13.8s p95 (up to 18.6s) purely from the runtime's own request-handling
// concurrency limits (its `per_worker` policy, see supabase/config.toml —
// this is the same root cause documented for the reverted tvmaze-cache
// function, not a data-store latency problem, so making the backing store
// faster — see redis.ts — never fixed it on its own). tmdb_api_cache's RLS
// already grants any authenticated user a direct select (supabase/
// schema.sql), so no server-side change was needed to unlock this path.
// The Edge Function itself is only reached now on a genuine miss/stale row
// — far less frequent, and not driven directly by concurrent *user* count
// the way every cache hit was.
async function fetchViaSharedCache<T>(
  path: string,
  ttlMs: number
): Promise<{ hit: true; payload: T } | { hit: false }> {
  try {
    const { data: row } = await supabase
      .from("tmdb_api_cache")
      .select("payload, fetched_at")
      .eq("path", path)
      .maybeSingle();
    if (row && Date.now() - new Date(row.fetched_at).getTime() < ttlMs) {
      return { hit: true, payload: row.payload as T };
    }
  } catch {
    // Direct read unavailable — fall through to the Edge Function below,
    // which does the same check again (Redis-first) as its own fallback.
  }

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return { hit: false };
    const { data, error } = await supabase.functions.invoke<{ payload: T }>("tmdb-cache", {
      headers: { Authorization: `Bearer ${token}` },
      body: { path, ttlMs },
    });
    if (error || !data) return { hit: false };
    return { hit: true, payload: data.payload };
  } catch {
    return { hit: false };
  }
}

export function posterUrl(path: string | null, size: "w200" | "w342" | "w500" = "w342") {
  return path ? `${IMAGE_BASE_URL}/${size}${path}` : null;
}

export function backdropUrl(path: string | null, size: "w780" | "w1280" = "w1280") {
  return path ? `${IMAGE_BASE_URL}/${size}${path}` : null;
}

// A missing/empty release_date (unconfirmed date, or no TMDB match at all)
// is treated as "already out" rather than blocked — there's no legitimate
// signal to count down to, and it's far more often an obscure/older title
// TMDB just never dated than a genuinely unannounced future release. Mirrors
// what app/(tabs)/movies.tsx's Upcoming/To Watch split already assumed.
export function isMovieReleased(releaseDate: string | null | undefined): boolean {
  if (!releaseDate) return true;
  return new Date(releaseDate).getTime() <= Date.now();
}

// The app only ever has a title (+ optional year) for a watched movie — TV
// Time's export has no TMDB id — so every lookup is a title search rather
// than a direct id fetch. Cached per title+year since the same movie is
// looked up again every time its detail page (or another with the same
// title) is opened.
export function searchMovie(title: string, year: number | null): Promise<TMDBSearchResult | null> {
  const params: Record<string, string> = { query: title };
  if (year) params.year = String(year);
  const path = pathWithQuery("/search/movie", params);
  return withCache(`search:${title}::${year ?? ""}`, ONE_DAY, async () => {
    const shared = await fetchViaSharedCache<{ results: TMDBSearchResult[] }>(path, ONE_DAY);
    const data = shared.hit ? shared.payload : await get<{ results: TMDBSearchResult[] }>("/search/movie", params);
    if (data.results.length === 0) return null;
    // Prefer an exact release-year match when the search returns several
    // (remakes, sequels sharing a title, etc.) — otherwise take the top hit,
    // which TMDB already ranks by relevance/popularity.
    if (year) {
      const exact = data.results.find((r) => r.release_date?.startsWith(String(year)));
      if (exact) return exact;
    }
    return data.results[0];
  });
}

export function getMovieDetails(tmdbId: number): Promise<TMDBMovieDetails> {
  const path = `/movie/${tmdbId}`;
  return withCache(`movie:${tmdbId}`, ONE_DAY, async () => {
    const shared = await fetchViaSharedCache<TMDBMovieDetails>(path, ONE_DAY);
    if (shared.hit) return shared.payload;
    return get<TMDBMovieDetails>(path);
  });
}

export function getMovieCast(tmdbId: number): Promise<TMDBCastMember[]> {
  const path = `/movie/${tmdbId}/credits`;
  return withCache(`credits:${tmdbId}`, ONE_DAY, async () => {
    const shared = await fetchViaSharedCache<{ cast: TMDBCastMember[] }>(path, ONE_DAY);
    const data = shared.hit ? shared.payload : await get<{ cast: TMDBCastMember[] }>(path);
    return [...data.cast].sort((a, b) => a.order - b.order);
  });
}

export function profileUrl(path: string | null, size: "w185" = "w185") {
  return path ? `${IMAGE_BASE_URL}/${size}${path}` : null;
}

export interface TMDBVideo {
  key: string;
  site: string;
  type: string;
  official: boolean;
}

function pickTrailer(videos: TMDBVideo[]): string | null {
  // TMDB's /videos endpoint returns every clip/featurette/teaser on file,
  // not just trailers — prefer an official YouTube "Trailer", fall back to
  // any YouTube trailer, then give up rather than link to a random clip.
  const youtube = videos.filter((v) => v.site === "YouTube");
  const trailer =
    youtube.find((v) => v.type === "Trailer" && v.official) ?? youtube.find((v) => v.type === "Trailer");
  return trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null;
}

export function getMovieTrailerUrl(tmdbId: number): Promise<string | null> {
  const path = `/movie/${tmdbId}/videos`;
  return withCache(`movie-videos:${tmdbId}`, ONE_DAY, async () => {
    const shared = await fetchViaSharedCache<{ results: TMDBVideo[] }>(path, ONE_DAY);
    const data = shared.hit ? shared.payload : await get<{ results: TMDBVideo[] }>(path);
    return pickTrailer(data.results);
  });
}

export function getTvTrailerUrl(tmdbTvId: number): Promise<string | null> {
  const path = `/tv/${tmdbTvId}/videos`;
  return withCache(`tv-videos:${tmdbTvId}`, ONE_DAY, async () => {
    const shared = await fetchViaSharedCache<{ results: TMDBVideo[] }>(path, ONE_DAY);
    const data = shared.hit ? shared.payload : await get<{ results: TMDBVideo[] }>(path);
    return pickTrailer(data.results);
  });
}

export interface WatchProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
}

export interface WatchProviders {
  link: string | null;
  flatrate: WatchProvider[];
  rent: WatchProvider[];
  buy: WatchProvider[];
}

const EMPTY_PROVIDERS: WatchProviders = { link: null, flatrate: [], rent: [], buy: [] };

// TMDB (via JustWatch) only has this per-country, not globally — there's no
// user-configurable region in this app (just an en/fr language toggle, not
// a locale), so this guesses a region from that: a genuine "which country's
// availability do I want" setting would be more correct, but this is a
// reasonable default until/unless that's asked for.
function regionForLanguage(language: "en" | "fr"): string {
  return language === "fr" ? "FR" : "US";
}

function pickRegion(
  results: Record<string, { link: string; flatrate?: WatchProvider[]; rent?: WatchProvider[]; buy?: WatchProvider[] }>,
  language: "en" | "fr"
): WatchProviders {
  const region = results[regionForLanguage(language)] ?? results["US"];
  if (!region) return EMPTY_PROVIDERS;
  return {
    link: region.link,
    flatrate: region.flatrate ?? [],
    rent: region.rent ?? [],
    buy: region.buy ?? [],
  };
}

// The raw TMDB response covers every region at once — caching *that*
// (rather than the single-region result pickRegion below produces) is what
// lets this be shared across every user regardless of their language, and
// also means a device switching language mid-TTL re-derives the right
// region from the same cached payload instead of serving the other
// region's stale pick until the entry expires.
function getMovieWatchProvidersRaw(tmdbId: number) {
  const path = `/movie/${tmdbId}/watch/providers`;
  return withCache(`movie-providers-raw:${tmdbId}`, ONE_DAY, async () => {
    const shared = await fetchViaSharedCache<{ results: Record<string, any> }>(path, ONE_DAY);
    if (shared.hit) return shared.payload.results;
    return get<{ results: Record<string, any> }>(path).then((d) => d.results);
  });
}

export async function getMovieWatchProviders(tmdbId: number, language: "en" | "fr"): Promise<WatchProviders> {
  return pickRegion(await getMovieWatchProvidersRaw(tmdbId), language);
}

function getTvWatchProvidersRaw(tmdbTvId: number) {
  const path = `/tv/${tmdbTvId}/watch/providers`;
  return withCache(`tv-providers-raw:${tmdbTvId}`, ONE_DAY, async () => {
    const shared = await fetchViaSharedCache<{ results: Record<string, any> }>(path, ONE_DAY);
    if (shared.hit) return shared.payload.results;
    return get<{ results: Record<string, any> }>(path).then((d) => d.results);
  });
}

export async function getTvWatchProviders(tmdbTvId: number, language: "en" | "fr"): Promise<WatchProviders> {
  return pickRegion(await getTvWatchProvidersRaw(tmdbTvId), language);
}

export function getMovieRecommendations(tmdbId: number): Promise<TMDBSearchResult[]> {
  const path = `/movie/${tmdbId}/recommendations`;
  return withCache(`movie-recs:${tmdbId}`, ONE_DAY, async () => {
    const shared = await fetchViaSharedCache<{ results: TMDBSearchResult[] }>(path, ONE_DAY);
    const data = shared.hit ? shared.payload : await get<{ results: TMDBSearchResult[] }>(path);
    return data.results.slice(0, 12);
  });
}

// Multi-result search (for the Explore "search everything" box) — distinct
// from searchMovie above, which picks the single best match for a known
// watched title. Cached per query since the same text is often retyped.
export function searchMovies(query: string): Promise<TMDBSearchResult[]> {
  const path = pathWithQuery("/search/movie", { query });
  return withCache(`searchAll:${query}`, ONE_DAY, async () => {
    const shared = await fetchViaSharedCache<{ results: TMDBSearchResult[] }>(path, ONE_DAY);
    const data = shared.hit ? shared.payload : await get<{ results: TMDBSearchResult[] }>("/search/movie", { query });
    return data.results;
  });
}

function cachedMovieList(path: string) {
  return () =>
    withCache(`list:${path}`, ONE_DAY, async () => {
      const shared = await fetchViaSharedCache<{ results: TMDBSearchResult[] }>(path, ONE_DAY);
      const data = shared.hit ? shared.payload : await get<{ results: TMDBSearchResult[] }>(path);
      return data.results;
    });
}

export const getPopularMovies = cachedMovieList("/movie/popular");
export const getTopRatedMovies = cachedMovieList("/movie/top_rated");
export const getNowPlayingMovies = cachedMovieList("/movie/now_playing");
export const getUpcomingMovies = cachedMovieList("/movie/upcoming");

// "For You" (see lib/forYou.ts) — popularity-sorted discover filtered to the
// genres the user actually watches most, rather than one more generic
// popular/top-rated list. Cache key includes the genre list since unlike the
// four lists above, this varies per user, not just per day — the shared
// cache still helps whenever two users' top genres happen to match, not
// just identical ones.
export function getForYouMovies(genreIds: number[]): Promise<TMDBSearchResult[]> {
  if (genreIds.length === 0) return Promise.resolve([]);
  const params = { with_genres: genreIds.join(","), sort_by: "popularity.desc" };
  const path = pathWithQuery("/discover/movie", params);
  return withCache(`for-you-movies:${genreIds.join(",")}`, ONE_DAY, async () => {
    const shared = await fetchViaSharedCache<{ results: TMDBSearchResult[] }>(path, ONE_DAY);
    const data = shared.hit ? shared.payload : await get<{ results: TMDBSearchResult[] }>("/discover/movie", params);
    return data.results;
  });
}

// TVmaze and TMDB use entirely different internal ids for the same show, but
// both link out to the same third-party TheTVDB id — TMDB exposes it via
// /tv/{id}/external_ids, and TVmaze already has a lookup-by-tvdb-id endpoint
// (lib/tvmaze.ts's lookupShowByTvdbId, used elsewhere for TV Time imports).
// Chaining the two is what lets a TMDB-sourced show result resolve to the
// TVmaze id the rest of this app is built around (tracking, episodes, ...).
// Not every TMDB show has a tvdb_id on file, so this can legitimately
// return null — callers should treat that as "no match found", not an error.
interface TMDBTvExternalIds {
  tvdb_id: number | null;
  imdb_id: string | null;
}

function getTvExternalIds(tmdbTvId: number): Promise<TMDBTvExternalIds> {
  const path = `/tv/${tmdbTvId}/external_ids`;
  return withCache(`tv-external:${tmdbTvId}`, ONE_DAY, async () => {
    const shared = await fetchViaSharedCache<TMDBTvExternalIds>(path, ONE_DAY);
    if (shared.hit) return shared.payload;
    return get<TMDBTvExternalIds>(path);
  });
}

// Defaults to "high" for the interactive case (a direct tap in Explore that
// should jump the TVmaze queue) — Explore's background prefetch of every
// visible discover-category card (see explore.tsx) passes "low" explicitly,
// so a bulk pass over 40-80 cards never delays an actual interactive request.
export async function findTvmazeShowFromTmdbTv(
  tmdbTvId: number,
  priority: Priority = "high"
): Promise<TVMazeShow | null> {
  const external = await getTvExternalIds(tmdbTvId);
  if (!external.tvdb_id) return null;
  return lookupShowByTvdbId(external.tvdb_id, priority);
}

// The other direction of the same bridge: a TVmaze show (see
// TVMazeShow.externals.thetvdb) resolving to its TMDB id, so show/[id].tsx
// can show TMDB-only data (watch providers, trailer, recommendations) that
// TVmaze itself doesn't have. TMDB's /find endpoint accepts an external id
// directly — no need to search by title/year the way movies do.
export function findTmdbTvFromTvdbId(tvdbId: number): Promise<number | null> {
  const params = { external_source: "tvdb_id" };
  const path = pathWithQuery(`/find/${tvdbId}`, params);
  return withCache(`find-tvdb:${tvdbId}`, ONE_DAY, async () => {
    const shared = await fetchViaSharedCache<{ tv_results: { id: number }[] }>(path, ONE_DAY);
    const data = shared.hit ? shared.payload : await get<{ tv_results: { id: number }[] }>(`/find/${tvdbId}`, params);
    return data.tv_results[0]?.id ?? null;
  });
}

export function getTvRecommendations(tmdbTvId: number): Promise<TMDBTvResult[]> {
  const path = `/tv/${tmdbTvId}/recommendations`;
  return withCache(`tv-recs:${tmdbTvId}`, ONE_DAY, async () => {
    const shared = await fetchViaSharedCache<{ results: TMDBTvResult[] }>(path, ONE_DAY);
    const data = shared.hit ? shared.payload : await get<{ results: TMDBTvResult[] }>(path);
    return data.results.slice(0, 12);
  });
}

export interface TMDBTvResult {
  id: number;
  name: string;
  first_air_date: string;
  poster_path: string | null;
  vote_average: number;
}


function cachedTvList(path: string, params: Record<string, string> = {}) {
  const fullPath = pathWithQuery(path, params);
  return () =>
    withCache(`tvlist:${path}:${JSON.stringify(params)}`, ONE_DAY, async () => {
      const shared = await fetchViaSharedCache<{ results: TMDBTvResult[] }>(fullPath, ONE_DAY);
      const data = shared.hit ? shared.payload : await get<{ results: TMDBTvResult[] }>(path, params);
      return data.results;
    });
}

// Same 4-category shape as the movie side (Popular/Top Rated/Now
// Playing/Upcoming) — TV's closest equivalents to "in theaters" and
// "upcoming" are "on the air" (currently airing new episodes) and a
// discover query for shows premiering from today onward, since TMDB has no
// dedicated /tv/upcoming endpoint the way it does for movies.
export const getPopularTv = cachedTvList("/tv/popular");
export const getTopRatedTv = cachedTvList("/tv/top_rated");
export const getOnTheAirTv = cachedTvList("/tv/on_the_air");
export function getUpcomingTv() {
  const today = new Date().toISOString().slice(0, 10);
  return cachedTvList("/discover/tv", {
    "first_air_date.gte": today,
    sort_by: "popularity.desc",
  })();
}

// "For You" (see lib/forYou.ts) — same idea as getForYouMovies above, TV side.
export function getForYouTv(genreIds: number[]): Promise<TMDBTvResult[]> {
  if (genreIds.length === 0) return Promise.resolve([]);
  return cachedTvList("/discover/tv", { with_genres: genreIds.join(","), sort_by: "popularity.desc" })();
}
