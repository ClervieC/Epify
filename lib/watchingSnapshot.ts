import { createAsyncStorage } from "@react-native-async-storage/async-storage";
import { TVMazeEpisode } from "./tvmaze";
import { UserShow, WatchedEpisode } from "./userShows";

// The package's default export is a *legacy* singleton kept only for
// migration — on web it's backed by window.localStorage (~5-10MB quota,
// shared across everything else stored there), which is what caused
// QuotaExceededError on large watch lists. createAsyncStorage() gives this
// its own IndexedDB-backed database instead (hundreds of MB in practice, and
// isolated from whatever else the app stores). On native it's backed by the
// same underlying module as the default export, just its own namespaced db.
const storage = createAsyncStorage("watching_snapshot");

// Trimmed down from TVMazeEpisode: `summary` (an HTML description, often a
// few hundred characters) and `image` aren't read anywhere the Watch
// Next/History rows built from this snapshot are rendered (see
// components/EpisodeRow.tsx). Dropping them, on top of the IndexedDB move
// above, keeps this well clear of quota limits even for very large watch
// lists.
export type SnapshotEpisode = Omit<TVMazeEpisode, "summary" | "image">;

// Minimal shape of app/(tabs)/index.tsx's TrackedShow, duplicated here
// instead of imported to keep this module free of any UI-layer dependency.
export interface TrackedShowSnapshot {
  show: UserShow;
  episodes: SnapshotEpisode[];
  watchedIds: number[];
  watchedList: WatchedEpisode[];
}

const STORAGE_KEY = "watching_snapshot_v1";

// Persists the "watching"/"want_to_watch" tracked shows (episodes + watch
// status) across app restarts. The per-show caches in showDataCache.ts are
// keyed by show and only populated on demand, so on a cold launch there was
// nothing to render until fetchUserShows() + every show's episodes came back
// from the network — this snapshot lets the Watch Next screen paint
// instantly from the last known state while that fresh fetch runs.
// Kept as a fallback even after the IndexedDB move above: it's a much
// bigger quota, not an unlimited one.
function isQuotaError(err: unknown): boolean {
  return err instanceof Error && (err.name === "QuotaExceededError" || /quota/i.test(err.message));
}

export async function saveWatchingSnapshot(tracked: TrackedShowSnapshot[]): Promise<void> {
  try {
    await storage.setItem(STORAGE_KEY, JSON.stringify(tracked));
  } catch (err) {
    if (isQuotaError(err) && tracked.some((t) => t.show.status !== "watching")) {
      // Large accounts (hundreds of shows, each with a full episode list)
      // can still blow past the browser's ~5-10MB localStorage quota even
      // after trimming summary/image off every episode. want_to_watch shows
      // matter far less here than watching ones (there's no "next episode"
      // urgency for a show you haven't started), so drop them and retry
      // once instead of losing the snapshot entirely.
      await saveWatchingSnapshot(tracked.filter((t) => t.show.status === "watching"));
      return;
    }
    // Best-effort — a failed write just means the next cold launch falls
    // back to the network-only path. Logged (not swallowed silently) since
    // this failing quietly is exactly what makes an empty snapshot hard to
    // diagnose from the outside.
    console.warn("saveWatchingSnapshot failed", err);
  }
}

export async function loadWatchingSnapshot(): Promise<TrackedShowSnapshot[] | null> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TrackedShowSnapshot[];
  } catch (err) {
    console.warn("loadWatchingSnapshot failed", err);
    return null;
  }
}

// Structurally matches app/(tabs)/index.tsx's TrackedShow — expressed as a
// generic bound rather than an import, so this module stays free of any
// UI-layer dependency (see the comment on TrackedShowSnapshot above).
interface TrackedShowLike {
  show: UserShow;
  episodes: TVMazeEpisode[];
  watchedIds: Set<number>;
  watchedList: WatchedEpisode[];
}

export function toSnapshotShow(t: TrackedShowLike): TrackedShowSnapshot {
  return {
    show: t.show,
    episodes: t.episodes.map(({ summary: _summary, image: _image, ...rest }) => rest),
    watchedIds: Array.from(t.watchedIds),
    watchedList: t.watchedList,
  };
}

export function fromSnapshotShow(t: TrackedShowSnapshot): TrackedShowLike {
  return {
    show: t.show,
    episodes: t.episodes.map((e) => ({ ...e, summary: null, image: null })),
    watchedIds: new Set(t.watchedIds),
    watchedList: t.watchedList,
  };
}
