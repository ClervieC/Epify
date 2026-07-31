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
// from a short TTL, so these can all be long-lived.
function createCache<T>(name: string, ttlMs: number) {
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
          if (Date.now() - parsed.fetchedAt <= ttlMs) {
            map.set(id, parsed);
            return parsed.data;
          }
          // Expired, but kept around as a last-resort fallback below if the
          // fetch fails outright.
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

  return { get, set, invalidate, getOrFetch, clearMemory };
}

// Show metadata and episode lists are effectively static day-to-day, and
// lib/tvmaze.ts already persists them independently too — this layer's main
// job is skipping even that disk read on repeat calls within the same
// session (show list -> show detail -> episode detail all want the same
// data). Watched status is Supabase data with no persistence anywhere else,
// so this is the only cache standing between "open Watch List" and one
// network round-trip per followed show.
const SHOW_INFO_TTL = 24 * 60 * 60 * 1000;
const EPISODES_TTL = 6 * 60 * 60 * 1000;
const WATCHED_TTL = 6 * 60 * 60 * 1000;

const showInfoCache = createCache<TVMazeShow>("show", SHOW_INFO_TTL);
const episodesCache = createCache<TVMazeEpisode[]>("episodes", EPISODES_TTL);
const watchedCache = createCache<WatchedEpisode[]>("watched", WATCHED_TTL);

export function getCachedShow(showId: number, fetcher: () => Promise<TVMazeShow>, highPriority = false) {
  return showInfoCache.getOrFetch(showId, fetcher, highPriority);
}

export function getCachedEpisodes(showId: number, fetcher: () => Promise<TVMazeEpisode[]>, highPriority = false) {
  return episodesCache.getOrFetch(showId, fetcher, highPriority);
}

export function getCachedWatchedEpisodes(showId: number, fetcher: () => Promise<WatchedEpisode[]>) {
  return watchedCache.getOrFetch(showId, fetcher);
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
