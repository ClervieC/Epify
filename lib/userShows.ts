import { createAsyncStorage } from "@react-native-async-storage/async-storage";
import { supabase, getCurrentUserId } from "./supabase";
import { patchCachedWatchedEpisodes } from "./showDataCache";

// Persisted fallback for fetchUserShows() below — every show/episode detail
// screen calls it (alongside the TVmaze data, which is already cached and
// offline-resilient — see lib/tvmaze.ts/showDataCache.ts) just to know
// whether *this* show is tracked and to show watch progress. Without a
// cache of its own, that one live Supabase call failing offline used to
// take the whole screen down (a Promise.all with the cached calls) even
// though everything else needed to render was already on disk.
const userShowsCache = createAsyncStorage("user_shows_cache");
const USER_SHOWS_CACHE_KEY = "user_shows_v1";

export type ShowStatus = "watching" | "want_to_watch" | "watched" | "dropped" | "paused";

// Marking a new episode watched, or adding a show to a custom list, means
// the user is actively engaging with it again — leaving its status stuck on
// "Paused"/"Dropped" while that happens reads as a bug (the show never
// reappears in Watch Next, stays hidden in Profile's paused/dropped rows).
// A single scoped UPDATE (not a read-then-write) — the WHERE clause itself
// makes this a no-op for a show that's already watching/want_to_watch/fully
// watched, or not tracked at all. Best-effort: never throws, since this is a
// side effect of the real action (mark watched / add to list), not the
// action itself.
async function resumeIfPausedOrDropped(tvmazeId: number) {
  const userId = await getCurrentUserId();
  if (!userId) return;
  try {
    await supabase
      .from("user_shows")
      .update({ status: "watching" })
      .eq("user_id", userId)
      .eq("tvmaze_id", tvmazeId)
      .in("status", ["paused", "dropped"]);
  } catch {
    // Best-effort — see comment above.
  }
}

export interface UserShow {
  id: string;
  user_id: string;
  tvmaze_id: number;
  show_name: string;
  show_image: string | null;
  status: ShowStatus;
  is_favorite: boolean;
  rating: number | null;
  current_season: number | null;
  current_episode: number | null;
  notes: string | null;
  // Set only when status transitions to "want_to_watch" (see upsertUserShow
  // and setShowStatus below) — unlike updated_at, this doesn't reset on
  // unrelated edits (rating, notes, favorite), so it's the one field that
  // reliably answers "how long has this actually been sitting unwatched,"
  // which lib/staleWatchlist.ts relies on.
  want_to_watch_since: string | null;
  created_at: string;
  updated_at: string;
}

// Called on sign-out (see context/AuthContext.tsx) — this key has no user id
// in it, so without clearing it, signing into a different account on the
// same device would briefly show the previous account's tracked shows.
export async function clearUserShowsCache(): Promise<void> {
  try {
    await userShowsCache.removeItem(USER_SHOWS_CACHE_KEY);
  } catch {
    // Best-effort.
  }
}

// Instant, local-only read of the same persisted fallback fetchUserShows()
// writes to — used by show/episode detail screens to paint their "is this
// tracked?" state immediately instead of waiting on a live Supabase
// round-trip just to answer that one question. Callers still follow up with
// a real fetchUserShows() to correct this if it's gone stale.
export async function getCachedUserShowsFast(): Promise<UserShow[] | null> {
  try {
    const cached = await userShowsCache.getItem(USER_SHOWS_CACHE_KEY);
    return cached ? (JSON.parse(cached) as UserShow[]) : null;
  } catch {
    return null;
  }
}

export async function fetchUserShows(userId?: string) {
  const targetUserId = userId ?? (await getCurrentUserId());
  if (!targetUserId) return [];
  // Only cache/fall back for "my own shows" (the common, unparameterized
  // call) — an explicit userId means viewing someone else's list, which
  // isn't what offline browsing of *your* watchlist needs to cover.
  const isOwnShows = !userId;

  try {
    const { data, error } = await supabase
      .from("user_shows")
      .select("*")
      .eq("user_id", targetUserId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    if (isOwnShows) userShowsCache.setItem(USER_SHOWS_CACHE_KEY, JSON.stringify(data)).catch(() => {});
    return data as UserShow[];
  } catch (err) {
    if (isOwnShows) {
      const cached = await userShowsCache.getItem(USER_SHOWS_CACHE_KEY).catch(() => null);
      if (cached) return JSON.parse(cached) as UserShow[];
    }
    throw err;
  }
}

export async function upsertUserShow(params: {
  tvmaze_id: number;
  show_name: string;
  show_image: string | null;
  status: ShowStatus;
}) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("user_shows")
    .upsert(
      {
        user_id: userId,
        tvmaze_id: params.tvmaze_id,
        show_name: params.show_name,
        show_image: params.show_image,
        status: params.status,
        want_to_watch_since: params.status === "want_to_watch" ? new Date().toISOString() : null,
      },
      { onConflict: "user_id,tvmaze_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return data as UserShow;
}

export async function removeUserShow(tvmazeId: number) {
  const { error } = await supabase.from("user_shows").delete().eq("tvmaze_id", tvmazeId);
  if (error) throw error;
}

export async function setShowStatus(tvmazeId: number, status: ShowStatus) {
  const { data, error } = await supabase
    .from("user_shows")
    // Only stamp want_to_watch_since on the transition into that status —
    // leaving it untouched (rather than clearing it) when moving to any
    // other status, so a show that's later set back to want_to_watch here
    // gets a fresh timestamp instead of reusing a stale one from years ago.
    .update(status === "want_to_watch" ? { status, want_to_watch_since: new Date().toISOString() } : { status })
    .eq("tvmaze_id", tvmazeId)
    .select()
    .single();
  if (error) throw error;
  return data as UserShow;
}

export async function setShowFavorite(tvmazeId: number, isFavorite: boolean) {
  const { data, error } = await supabase
    .from("user_shows")
    .update({ is_favorite: isFavorite })
    .eq("tvmaze_id", tvmazeId)
    .select()
    .single();
  if (error) throw error;
  return data as UserShow;
}

export async function fetchFavorites(userId?: string) {
  const targetUserId = userId ?? (await getCurrentUserId());
  if (!targetUserId) return [];

  const { data, error } = await supabase
    .from("user_shows")
    .select("*")
    .eq("user_id", targetUserId)
    .eq("is_favorite", true)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data as UserShow[];
}

export interface ShowList {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface ListItem {
  id: string;
  list_id: string;
  user_id: string;
  tvmaze_id: number;
  show_name: string;
  show_image: string | null;
  created_at: string;
}

export async function fetchLists() {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("lists")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as ShowList[];
}

export async function createList(name: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase.from("lists").insert({ user_id: userId, name }).select().single();
  if (error) throw error;
  return data as ShowList;
}

export async function fetchListItems(listId: string) {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("list_items")
    .select("*")
    .eq("list_id", listId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as ListItem[];
}

export async function fetchAllListItems() {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("list_items")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as ListItem[];
}

export async function addShowToList(
  listId: string,
  show: { tvmaze_id: number; show_name: string; show_image: string | null }
) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase.from("list_items").upsert(
    {
      list_id: listId,
      user_id: userId,
      tvmaze_id: show.tvmaze_id,
      show_name: show.show_name,
      show_image: show.show_image,
    },
    { onConflict: "list_id,tvmaze_id" }
  );
  if (error) throw error;
  await resumeIfPausedOrDropped(show.tvmaze_id);
}

// Removes one show from one custom list only — leaves the show's own
// tracked status (user_shows) untouched. Was missing entirely: app/list/[id].tsx
// had no way to take an item back out of a list once added.
export async function removeShowFromList(listId: string, tvmazeId: number) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("list_items")
    .delete()
    .eq("list_id", listId)
    .eq("tvmaze_id", tvmazeId)
    .eq("user_id", userId);
  if (error) throw error;
}

// Deletes a custom list and everything in it. Callers are expected to have
// already confirmed with the user — app/list/[id].tsx checks emptiness (or
// offers moveListItemsAndDeleteList below) before calling this directly.
export async function deleteList(listId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error: itemsError } = await supabase
    .from("list_items")
    .delete()
    .eq("list_id", listId)
    .eq("user_id", userId);
  if (itemsError) throw itemsError;

  const { error } = await supabase.from("lists").delete().eq("id", listId).eq("user_id", userId);
  if (error) throw error;
}

// Copies every item of a non-empty list into another list (skipping any
// already present there, via onConflict ignore) then deletes the source
// list — the "move the shows somewhere else first" path when deleting a
// custom list that isn't empty (see app/list/[id].tsx).
export async function moveListItemsAndDeleteList(fromListId: string, toListId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const items = await fetchListItems(fromListId);
  if (items.length > 0) {
    const { error } = await supabase.from("list_items").upsert(
      items.map((i) => ({
        list_id: toListId,
        user_id: userId,
        tvmaze_id: i.tvmaze_id,
        show_name: i.show_name,
        show_image: i.show_image,
      })),
      { onConflict: "list_id,tvmaze_id", ignoreDuplicates: true }
    );
    if (error) throw error;
  }
  await deleteList(fromListId);
}

export interface WatchedEpisode {
  id: string;
  user_id: string;
  tvmaze_show_id: number;
  tvmaze_episode_id: number;
  season: number;
  number: number;
  watched: boolean;
  watched_at: string;
  rating: number | null;
  feeling: string | null;
  times_watched: number;
  is_favorite: boolean;
}

export async function fetchEpisodeCount(userId?: string) {
  const targetUserId = userId ?? (await getCurrentUserId());
  if (!targetUserId) return 0;

  const { count, error } = await supabase
    .from("watched_episodes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", targetUserId);
  if (error) throw error;
  return count ?? 0;
}

export async function fetchWatchedEpisodes(showId: number) {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("watched_episodes")
    .select("*")
    .eq("user_id", userId)
    .eq("tvmaze_show_id", showId);
  if (error) throw error;
  return data as WatchedEpisode[];
}

// Global, paginated (across every followed show) history query — used to lazy
// load "Watched history" a page at a time instead of pulling every episode
// the user has ever watched into memory up front.
export async function fetchWatchedEpisodesPage(offset: number, limit: number) {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("watched_episodes")
    .select("*")
    .eq("user_id", userId)
    .order("watched_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return data as WatchedEpisode[];
}

export async function setEpisodeWatched(params: {
  tvmaze_show_id: number;
  tvmaze_episode_id: number;
  season: number;
  number: number;
  watched: boolean;
}) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  if (!params.watched) {
    const { error } = await supabase
      .from("watched_episodes")
      .delete()
      .eq("user_id", userId)
      .eq("tvmaze_episode_id", params.tvmaze_episode_id);
    if (error) throw error;
    // Patches the cache with the now-known-correct list instead of just
    // invalidating it — otherwise the Shows tab's next focus (e.g. right
    // after unmarking an episode from its own detail screen) paid a real
    // network round trip just to re-learn what this call already knows,
    // showing the episode as still watched for a beat in the meantime.
    patchCachedWatchedEpisodes(params.tvmaze_show_id, (prev) =>
      prev.filter((w) => w.tvmaze_episode_id !== params.tvmaze_episode_id)
    );
    return null;
  }

  const { data, error } = await supabase
    .from("watched_episodes")
    .upsert(
      {
        user_id: userId,
        tvmaze_show_id: params.tvmaze_show_id,
        tvmaze_episode_id: params.tvmaze_episode_id,
        season: params.season,
        number: params.number,
        watched: true,
      },
      { onConflict: "user_id,tvmaze_episode_id" }
    )
    .select()
    .single();
  if (error) throw error;
  const row = data as WatchedEpisode;
  patchCachedWatchedEpisodes(params.tvmaze_show_id, (prev) => [
    ...prev.filter((w) => w.tvmaze_episode_id !== params.tvmaze_episode_id),
    row,
  ]);
  await resumeIfPausedOrDropped(params.tvmaze_show_id);
  return row;
}

export async function setEpisodesWatched(
  showId: number,
  episodes: { id: number; season: number; number: number }[]
) {
  if (episodes.length === 0) return;
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("watched_episodes")
    .upsert(
      episodes.map((ep) => ({
        user_id: userId,
        tvmaze_show_id: showId,
        tvmaze_episode_id: ep.id,
        season: ep.season,
        number: ep.number,
        watched: true,
      })),
      { onConflict: "user_id,tvmaze_episode_id" }
    )
    .select();
  if (error) throw error;
  const rows = data as WatchedEpisode[];
  const newIds = new Set(rows.map((r) => r.tvmaze_episode_id));
  patchCachedWatchedEpisodes(showId, (prev) => [...prev.filter((w) => !newIds.has(w.tvmaze_episode_id)), ...rows]);
  await resumeIfPausedOrDropped(showId);
}

export async function setEpisodesUnwatched(showId: number, episodeIds: number[]) {
  if (episodeIds.length === 0) return;
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("watched_episodes")
    .delete()
    .eq("user_id", userId)
    .in("tvmaze_episode_id", episodeIds);
  if (error) throw error;
  const removed = new Set(episodeIds);
  patchCachedWatchedEpisodes(showId, (prev) => prev.filter((w) => !removed.has(w.tvmaze_episode_id)));
}

// Bulk version of incrementRewatch — used to mark a whole season/show as
// rewatched at once. times_watched can't be incremented in a single set-based
// update (each row starts from a different count), so each row gets its own
// update, run concurrently since a season is at most a few dozen episodes.
export async function bulkIncrementRewatch(
  showId: number,
  episodes: { episodeId: number; timesWatched: number }[]
) {
  if (episodes.length === 0) return;
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const watchedAt = new Date().toISOString();
  const results = await Promise.all(
    episodes.map((e) =>
      supabase
        .from("watched_episodes")
        .update({ times_watched: e.timesWatched + 1, watched_at: watchedAt })
        .eq("user_id", userId)
        .eq("tvmaze_episode_id", e.episodeId)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
  // Patched from the already-known new counts rather than re-fetched —
  // spreading each existing cached row keeps its other fields (rating,
  // feeling, is_favorite) intact instead of needing a second round trip
  // just to learn what this call already knows.
  const newCounts = new Map(episodes.map((e) => [e.episodeId, e.timesWatched + 1]));
  patchCachedWatchedEpisodes(showId, (prev) =>
    prev.map((w) =>
      newCounts.has(w.tvmaze_episode_id)
        ? { ...w, times_watched: newCounts.get(w.tvmaze_episode_id)!, watched_at: watchedAt }
        : w
    )
  );
}

// Mirrors bulkIncrementRewatch — "I didn't actually rewatch this whole
// season again, I misclicked" at the season level. watched_at is left alone
// per episode, same reasoning as decrementRewatch: there's no record of each
// episode's *previous* watch to restore.
export async function bulkDecrementRewatch(
  showId: number,
  episodes: { episodeId: number; timesWatched: number }[]
) {
  if (episodes.length === 0) return;
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const results = await Promise.all(
    episodes.map((e) =>
      supabase
        .from("watched_episodes")
        .update({ times_watched: Math.max(1, e.timesWatched - 1) })
        .eq("user_id", userId)
        .eq("tvmaze_episode_id", e.episodeId)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
  const newCounts = new Map(episodes.map((e) => [e.episodeId, Math.max(1, e.timesWatched - 1)]));
  patchCachedWatchedEpisodes(showId, (prev) =>
    prev.map((w) => (newCounts.has(w.tvmaze_episode_id) ? { ...w, times_watched: newCounts.get(w.tvmaze_episode_id)! } : w))
  );
}

export async function bulkUpsertWatchedEpisodes(
  showId: number,
  records: { episodeId: number; season: number; number: number; watchedAt: string; timesWatched: number }[]
) {
  if (records.length === 0) return;
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const CHUNK_SIZE = 300;
  const upserted: WatchedEpisode[] = [];
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    const chunk = records.slice(i, i + CHUNK_SIZE);
    const { data, error } = await supabase
      .from("watched_episodes")
      .upsert(
        chunk.map((r) => ({
          user_id: userId,
          tvmaze_show_id: showId,
          tvmaze_episode_id: r.episodeId,
          season: r.season,
          number: r.number,
          watched: true,
          watched_at: r.watchedAt,
          times_watched: r.timesWatched,
        })),
        { onConflict: "user_id,tvmaze_episode_id" }
      )
      .select();
    if (error) throw error;
    upserted.push(...(data as WatchedEpisode[]));
  }
  const newIds = new Set(upserted.map((r) => r.tvmaze_episode_id));
  patchCachedWatchedEpisodes(showId, (prev) => [...prev.filter((w) => !newIds.has(w.tvmaze_episode_id)), ...upserted]);
}

export async function rateEpisode(
  showId: number,
  tvmazeEpisodeId: number,
  rating: number | null,
  feeling: string | null
) {
  const { data, error } = await supabase
    .from("watched_episodes")
    .update({ rating, feeling })
    .eq("tvmaze_episode_id", tvmazeEpisodeId)
    .select()
    .single();
  if (error) throw error;
  const row = data as WatchedEpisode;
  patchCachedWatchedEpisodes(showId, (prev) => prev.map((w) => (w.tvmaze_episode_id === tvmazeEpisodeId ? row : w)));
}

// Only ever called on an episode that's already watched (see the heart
// toggle in app/episode/[id].tsx, gated the same way rating/feeling are) —
// a favorite with nothing watched to attach it to has no row to set this on.
export async function setEpisodeFavorite(showId: number, tvmazeEpisodeId: number, isFavorite: boolean) {
  const { data, error } = await supabase
    .from("watched_episodes")
    .update({ is_favorite: isFavorite })
    .eq("tvmaze_episode_id", tvmazeEpisodeId)
    .select()
    .single();
  if (error) throw error;
  const row = data as WatchedEpisode;
  patchCachedWatchedEpisodes(showId, (prev) => prev.map((w) => (w.tvmaze_episode_id === tvmazeEpisodeId ? row : w)));
}

// For Profile's "Favorite episodes" section — global across every show,
// mirroring fetchWatchedEpisodesPage's own global (not per-show) query.
export async function fetchFavoriteEpisodes(): Promise<WatchedEpisode[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("watched_episodes")
    .select("*")
    .eq("user_id", userId)
    .eq("is_favorite", true)
    .order("watched_at", { ascending: false });
  if (error) throw error;
  return data as WatchedEpisode[];
}

// Aggregate, anonymous count of how everyone who's watched this episode felt
// about it — only the `feeling` column is selected, never the full row (no
// user_id, rating, or watch history leaks out), same spirit as the
// public-profile episode count query above.
export async function fetchEpisodeFeelingCounts(episodeId: number): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("watched_episodes")
    .select("feeling")
    .eq("tvmaze_episode_id", episodeId)
    .not("feeling", "is", null);
  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const row of data as { feeling: string | null }[]) {
    if (!row.feeling) continue;
    counts[row.feeling] = (counts[row.feeling] ?? 0) + 1;
  }
  return counts;
}

export async function incrementRewatch(tvmazeEpisodeId: number, currentTimesWatched: number) {
  const { data, error } = await supabase
    .from("watched_episodes")
    .update({ times_watched: currentTimesWatched + 1, watched_at: new Date().toISOString() })
    .eq("tvmaze_episode_id", tvmazeEpisodeId)
    .select()
    .single();
  if (error) throw error;
  const row = data as WatchedEpisode;
  patchCachedWatchedEpisodes(row.tvmaze_show_id, (prev) => prev.map((w) => (w.tvmaze_episode_id === tvmazeEpisodeId ? row : w)));
  return row;
}

// For "I didn't actually watch it again, I misclicked" — removes just the
// most recent rewatch instead of the full unwatch (which would erase every
// watch, not only the extra one). watched_at is left as-is: there's no
// record of the *previous* watch's timestamp to restore, and the row is
// still genuinely watched around this time, just not twice.
export async function decrementRewatch(tvmazeEpisodeId: number, currentTimesWatched: number) {
  const { data, error } = await supabase
    .from("watched_episodes")
    .update({ times_watched: Math.max(1, currentTimesWatched - 1) })
    .eq("tvmaze_episode_id", tvmazeEpisodeId)
    .select()
    .single();
  if (error) throw error;
  const row = data as WatchedEpisode;
  patchCachedWatchedEpisodes(row.tvmaze_show_id, (prev) => prev.map((w) => (w.tvmaze_episode_id === tvmazeEpisodeId ? row : w)));
  return row;
}
