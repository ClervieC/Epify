import { createAsyncStorage } from "@react-native-async-storage/async-storage";
import type { TVMazeEpisode, TVMazeShow } from "./tvmaze";
import type { WatchedEpisode } from "./userShows";

// See the same comment in lib/tvmaze.ts: the package's default export is a
// legacy singleton backed by window.localStorage on web (~5-10MB, shared
// with everything else stored there, including Supabase's own session
// token) — this cache is per-show and unbounded, so on web it contributed to
// filling that shared quota entirely. Its own IndexedDB database avoids that.
const storage = createAsyncStorage("show_data_cache");

const STORAGE_PREFIX = "show_data_cache:";

// Generic cache-aside helper, persisted to disk (not just in-memory) so a
// cold app start doesn't have to re-fetch every tracked show's episodes and
// watched status from scratch before the Watch List/show detail can render —
// that network round-trip, repeated for every followed show, was the main
// reason those screens were slow to load. Correctness comes from the
// explicit invalidate() calls on every mutation (see lib/userShows.ts), not
// from a short TTL, so these can all be long-lived — for data where that
// holds. `mustRevalidate` is the escape hatch for data where it doesn't (see
// watchedCache below): invalidate() is implemented as an in-memory Map
// (invalidatedAt), which is wiped on every process kill, so it protects
// nothing that happened before the app's *current* cold start. Without this
// flag, a disk-persisted entry within ttlMs is trusted and returned as-is —
// no network call at all — meaning a watched/unwatched mutation from a
// previous session (this device, hours ago, or any other device) can sit
// uncorrected in the UI for up to the full TTL after reopening the app, a
// real bug this flag exists specifically to close.
function createCache<T>(name: string, ttlMs: number, opts: { mustRevalidate?: boolean } = {}) {
  const mustRevalidate = opts.mustRevalidate ?? false;
  const map = new Map<number, { data: T; fetchedAt: number }>();
  // Bumped by invalidate() so a fetch already in flight when the
  // invalidation lands doesn't overwrite it with the pre-mutation data it
  // resolves with — without this, a slow fetchWatchedEpisodes racing a
  // "mark watched" mutation could resurrect stale state for the full TTL.
  const invalidatedAt = new Map<number, number>();
  // Dedupes concurrent getOrFetch calls for the same id (e.g. Watch List
  // and a show's detail screen open at once) onto a single in-flight fetch —
  // but only when they're the same priority. A background low-priority
  // fetch (Watch List's tracked-shows prefetch, recap, showStats, ...) that
  // happens to already be in flight for a show the user then taps into must
  // not have the tap's fetch silently merged into it: TVmaze's high/low
  // queue (lib/tvmaze.ts) exists precisely so an interactive open jumps
  // ahead of queued background work, and reusing the low-priority promise
  // here would defeat that by inheriting its place in line.
  const inFlight = new Map<number, { promise: Promise<T>; highPriority: boolean }>();

  function storageKey(id: number) {
    return `${STORAGE_PREFIX}${name}:${id}`;
  }

  function get(id: number): T | null {
    const entry = map.get(id);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > ttlMs) {
      map.delete(id);
      return null;
    }
    return entry.data;
  }

  function set(id: number, data: T) {
    const entry = { data, fetchedAt: Date.now() };
    map.set(id, entry);
    storage.setItem(storageKey(id), JSON.stringify(entry)).catch(() => {});
  }

  function invalidate(id: number) {
    invalidatedAt.set(id, Date.now());
    map.delete(id);
    storage.removeItem(storageKey(id)).catch(() => {});
  }

  function clearMemory() {
    map.clear();
    inFlight.clear();
  }

  async function getOrFetch(id: number, fetcher: () => Promise<T>, highPriority = false): Promise<T> {
    const cached = get(id);
    if (cached) return cached;

    const existing = inFlight.get(id);
    if (existing && (existing.highPriority || !highPriority)) return existing.promise;

    const startedAt = Date.now();
    const promise = (async () => {
      let stalePersisted: T | undefined;
      try {
        const stored = await storage.getItem(storageKey(id));
        if (stored) {
          const parsed = JSON.parse(stored) as { data: T; fetchedAt: number };
          if (!mustRevalidate && Date.now() - parsed.fetchedAt <= ttlMs) {
            map.set(id, parsed);
            return parsed.data;
          }
          // Either expired, or mustRevalidate always wants a live fetch on
          // first ask this session regardless of age — either way, kept
          // around as a last-resort fallback below if that fetch fails
          // outright.
          stalePersisted = parsed.data;
        }
      } catch {
        // Corrupt/unavailable entry — fall through and refetch.
      }

      try {
        let data = await fetcher();
        // A concurrent invalidate() that landed after this fetch started
        // (e.g. marking an episode watched while this exact show's watched
        // list was already being re-fetched — see the Watch Next screen's
        // loadData()) means the data we just fetched predates that mutation.
        // Not writing it to cache used to be enough, but it was still handed
        // back to whoever's awaiting *this* call, silently overwriting a
        // fresher optimistic update with pre-mutation data (the show's Watch
        // Next row would then look stuck on the episode that was just marked
        // watched). One refetch — now started after the invalidation —
        // actually reflects the mutation instead.
        if ((invalidatedAt.get(id) ?? 0) >= startedAt) {
          data = await fetcher();
        }
        set(id, data);
        return data;
      } catch (err) {
        // Network blip — better to show stale data than an error screen.
        if (stalePersisted !== undefined) return stalePersisted;
        const memoryStale = map.get(id);
        if (memoryStale) return memoryStale.data;
        throw err;
      }
    })();

    const entry = { promise, highPriority };
    inFlight.set(id, entry);
    try {
      return await promise;
    } finally {
      // Only clear if this is still the current entry — a high-priority
      // call that started after this one (and so replaced it above without
      // waiting for it) owns the slot now, and this fetch finishing shouldn't
      // clear that newer entry out from under it.
      if (inFlight.get(id) === entry) inFlight.delete(id);
    }
  }

  // Warms many ids with a single batched network call instead of one
  // getOrFetch per id — used where a screen is about to fetch the same kind
  // of data for a whole list of ids at once (e.g. watched episodes for
  // every tracked show on cold app open, see primeWatchedEpisodes below).
  // Mirrors getOrFetch's own disk-check and invalidatedAt race-safety per
  // id, and registers a shared in-flight entry per id so a getOrFetch call
  // for one of these ids that follows right after (e.g. the per-show loop
  // that runs after priming) dedupes onto the batch instead of firing its
  // own request.
  async function primeMany(ids: number[], batchFetcher: (missingIds: number[]) => Promise<Map<number, T>>): Promise<void> {
    const toFetch = ids.filter((id) => get(id) === null && !inFlight.has(id));
    if (toFetch.length === 0) return;

    const startedAt = Date.now();
    const stillMissing: number[] = [];
    for (const id of toFetch) {
      try {
        const stored = await storage.getItem(storageKey(id));
        if (stored) {
          const parsed = JSON.parse(stored) as { data: T; fetchedAt: number };
          if (!mustRevalidate && Date.now() - parsed.fetchedAt <= ttlMs) {
            map.set(id, parsed);
            continue;
          }
        }
      } catch {
        // Corrupt/unavailable entry — fall through and include it in the batch.
      }
      stillMissing.push(id);
    }
    if (stillMissing.length === 0) return;

    const batchPromise = (async () => {
      let fetched: Map<number, T>;
      try {
        fetched = await batchFetcher(stillMissing);
      } catch {
        // Batch failed outright — leave these ids uncached; individual
        // getOrFetch calls for them fall back to fetching one at a time.
        return;
      }
      for (const id of stillMissing) {
        if ((invalidatedAt.get(id) ?? 0) >= startedAt) continue;
        const data = fetched.get(id);
        if (data !== undefined) set(id, data);
      }
    })();

    const entries = new Map(
      stillMissing.map((id) => [id, { promise: batchPromise.then(() => get(id) as T), highPriority: false }])
    );
    for (const [id, entry] of entries) inFlight.set(id, entry);
    await batchPromise;
    // Only clear an id's slot if it's still this batch's entry — a
    // getOrFetch call for that id that started after the batch (and so
    // replaced it above without waiting) owns the slot now.
    for (const [id, entry] of entries) {
      if (inFlight.get(id) === entry) inFlight.delete(id);
    }
  }

  return { get, set, invalidate, getOrFetch, primeMany, clearMemory };
}

// Show metadata and episode lists are effectively static day-to-day, and
// lib/tvmaze.ts already persists them independently too — this layer's main
// job is skipping even that disk read on repeat calls within the same
// session (show list -> show detail -> episode detail all want the same
// data), so trusting a same-device disk copy up to a day/6h old is fine —
// nothing external mutates this data on a timescale that matters here.
// Watched status is the opposite: it's mutated by a single tap, from any of
// the user's devices, and "was this episode watched" is exactly the
// question a stale answer breaks — so watchedCache opts into mustRevalidate
// (see createCache above) despite sharing the same nominal TTL as episodes.
const SHOW_INFO_TTL = 24 * 60 * 60 * 1000;
const EPISODES_TTL = 6 * 60 * 60 * 1000;
const WATCHED_TTL = 6 * 60 * 60 * 1000;

const showInfoCache = createCache<TVMazeShow>("show", SHOW_INFO_TTL);
const episodesCache = createCache<TVMazeEpisode[]>("episodes", EPISODES_TTL);
const watchedCache = createCache<WatchedEpisode[]>("watched", WATCHED_TTL, { mustRevalidate: true });

export function getCachedShow(showId: number, fetcher: () => Promise<TVMazeShow>, highPriority = false) {
  return showInfoCache.getOrFetch(showId, fetcher, highPriority);
}

export function getCachedEpisodes(showId: number, fetcher: () => Promise<TVMazeEpisode[]>, highPriority = false) {
  return episodesCache.getOrFetch(showId, fetcher, highPriority);
}

export function getCachedWatchedEpisodes(showId: number, fetcher: () => Promise<WatchedEpisode[]>) {
  return watchedCache.getOrFetch(showId, fetcher);
}

// Warms watchedCache for a whole list of shows with one batched Supabase
// call — call this before a mapWithConcurrency loop that's about to call
// getCachedWatchedEpisodes per show (Watch List's tracked-shows load,
// backgroundPrefetch's library warm-up), so N round trips become 1. Each
// getCachedWatchedEpisodes call after this resolves from the now-warm
// cache; a show that somehow missed the batch just falls back to its own
// individual fetch, same as before this existed.
export function primeWatchedEpisodes(
  showIds: number[],
  batchFetcher: (missingIds: number[]) => Promise<Map<number, WatchedEpisode[]>>
) {
  return watchedCache.primeMany(showIds, batchFetcher);
}

export function invalidateWatchedEpisodes(showId: number) {
  watchedCache.invalidate(showId);
}

// Writes a known-correct watched-episodes list straight into the cache
// instead of just invalidating it — used right after a mutation whose
// result is already known (see setEpisodeWatched in lib/userShows.ts), so
// the next read (e.g. the Shows tab's loadData() on refocus after marking an
// episode watched from its own detail screen) is an instant cache hit
// instead of a real network round trip. Falls back to a plain invalidate if
// this show was never cached in the first place — nothing to correctly
// patch, and a wrong guess here would be worse than just refetching.
export function patchCachedWatchedEpisodes(
  showId: number,
  updater: (prev: WatchedEpisode[]) => WatchedEpisode[]
) {
  const current = watchedCache.get(showId);
  if (current === null) {
    invalidateWatchedEpisodes(showId);
    return;
  }
  watchedCache.set(showId, updater(current));
}

export function invalidateShow(showId: number) {
  showInfoCache.invalidate(showId);
  episodesCache.invalidate(showId);
  watchedCache.invalidate(showId);
}

// Called on sign-out (see context/AuthContext.tsx) — watchedCache holds
// per-user data (a specific account's watched/unwatched checkmarks) keyed
// only by show id, with no user id in the key at all, so without this a
// different account signing in on the same device would see the previous
// user's watched status for any show they both track. show/episodes are
// public metadata (harmless to keep), but they share this same underlying
// storage instance, so a full wipe is simplest — refetching them for the
// new user is cheap and correctness-neutral either way.
export async function clearAllShowDataCaches(): Promise<void> {
  showInfoCache.clearMemory();
  episodesCache.clearMemory();
  watchedCache.clearMemory();
  await storage.clear().catch(() => {});
}
