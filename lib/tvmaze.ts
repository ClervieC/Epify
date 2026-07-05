import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE_URL = "https://api.tvmaze.com";
const CACHE_PREFIX = "tvmaze_cache:";
const ONE_HOUR = 60 * 60 * 1000;
const SIX_HOURS = 6 * ONE_HOUR;

const memoryCache = new Map<string, { data: unknown; expiresAt: number }>();

// Show metadata and episode lists rarely change and are identical for every user,
// so caching them (in-memory for the session, persisted to disk across restarts)
// avoids re-fetching the same show over and over as you move between screens
// (Shows list -> show detail -> episode detail all ask for the same data).
async function withCache<T>(cacheKey: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = memoryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.data as T;

  const storageKey = CACHE_PREFIX + cacheKey;
  try {
    const stored = await AsyncStorage.getItem(storageKey);
    if (stored) {
      const parsed = JSON.parse(stored) as { data: T; expiresAt: number };
      if (parsed.expiresAt > now) {
        memoryCache.set(cacheKey, parsed);
        return parsed.data;
      }
    }
  } catch {
    // Corrupt/unavailable cache entry — fall through and refetch.
  }

  const data = await fetcher();
  const entry = { data, expiresAt: now + ttlMs };
  memoryCache.set(cacheKey, entry);
  AsyncStorage.setItem(storageKey, JSON.stringify(entry)).catch(() => {});
  return data;
}

export interface TVMazeShow {
  id: number;
  name: string;
  summary: string | null;
  status: string;
  premiered: string | null;
  ended: string | null;
  rating: { average: number | null };
  genres: string[];
  image: { medium: string; original: string } | null;
  network: { name: string; country: { name: string } | null } | null;
  webChannel: { name: string } | null;
  schedule: { time: string; days: string[] };
}

export interface TVMazeEpisode {
  id: number;
  name: string;
  season: number;
  number: number;
  airdate: string;
  airstamp: string;
  runtime: number | null;
  summary: string | null;
  image: { medium: string; original: string } | null;
}

export interface ScheduleEntry {
  id: number;
  airdate: string;
  airtime: string;
  season: number;
  number: number;
  name: string;
  show: TVMazeShow;
}

// TVmaze rate-limits at ~20 calls/10s per IP. Now that shows are fetched with several
// requests in flight at once (see importTvTimeShowsJson), a 429 is expected occasionally
// rather than exceptional — back off and retry a couple of times before giving up.
async function fetchWithRetry(path: string, retriesLeft = 3): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (res.status === 429 && retriesLeft > 0) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return fetchWithRetry(path, retriesLeft - 1);
  }
  return res;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetchWithRetry(path);
  if (!res.ok) {
    throw new Error(`TVmaze request failed (${res.status}): ${path}`);
  }
  return res.json() as Promise<T>;
}

export function searchShows(query: string) {
  return get<{ score: number; show: TVMazeShow }[]>(
    `/search/shows?q=${encodeURIComponent(query)}`
  );
}

export function getShow(id: number) {
  return withCache(`show:${id}`, SIX_HOURS, () => get<TVMazeShow>(`/shows/${id}`));
}

export function getShowEpisodes(id: number) {
  return withCache(`episodes:${id}`, ONE_HOUR, () => get<TVMazeEpisode[]>(`/shows/${id}/episodes`));
}

export function getTodaySchedule(countryCode = "US", date?: string) {
  const dateParam = date ? `&date=${date}` : "";
  return get<ScheduleEntry[]>(`/schedule?country=${countryCode}${dateParam}`);
}

export function getShowsIndex(page = 0) {
  return withCache(`index:${page}`, ONE_HOUR, () => get<TVMazeShow[]>(`/shows?page=${page}`));
}

export function getEpisode(id: number) {
  return get<TVMazeEpisode>(`/episodes/${id}`);
}

export function lookupShowByTvdbId(tvdbId: number): Promise<TVMazeShow | null> {
  return withCache(`tvdb:${tvdbId}`, SIX_HOURS, async () => {
    const res = await fetchWithRetry(`/lookup/shows?thetvdb=${tvdbId}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`TVmaze request failed (${res.status}): /lookup/shows?thetvdb=${tvdbId}`);
    }
    return res.json() as Promise<TVMazeShow>;
  });
}
