import { AppState, Platform } from "react-native";
import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import {
  findShowIdForWatchedRow,
  invalidateWatchedEpisodes,
  lastLocalWatchedWrite,
  revalidateAllWatchedEpisodes,
} from "./showDataCache";
import { getCachedUserShowsFast } from "./userShows";
import { isKnownMovieRow } from "./userMovies";

// Keeps one account's devices in step. Watched status is cached in memory
// for the whole session (see watchedCache in lib/showDataCache.ts), so
// before this, an episode marked watched on the computer only showed up on
// the phone after the phone's app was fully restarted. Two halves:
//
// - Realtime: while the app is open, every change to this user's
//   watched_episodes / user_shows / user_movies rows arrives over Supabase
//   Realtime (all three are in the supabase_realtime publication — see
//   supabase/schema.sql), the affected show's cache is dropped, and screens
//   that called useLiveSync reload.
// - Resume: a phone suspends the page (and its realtime socket) in the
//   background, so anything that happened meanwhile never arrives. Coming
//   back to the foreground drops every cached watched list and tells
//   screens to reload — one batched query on the Shows tab, not one per show.
//
// `showIds` null means "any show may have changed"; `movies` is true when
// the user's movies (user_movies) changed, or may have.
export type LiveSyncEvent = { showIds: number[] | null; movies: boolean };
type Listener = (event: LiveSyncEvent) => void;

const listeners = new Set<Listener>();

// Ignore realtime's echo of a write this device made itself within this
// window — its cache was already patched with the result.
const OWN_ECHO_WINDOW_MS = 5000;
// A quick glance away (notification, app switcher) shorter than this
// doesn't count as "may have missed something".
const RESUME_MIN_HIDDEN_MS = 2000;
// Coalesces a burst (a whole season marked watched = one event per row)
// into a single reload.
const EMIT_DEBOUNCE_MS = 300;

let pendingShowIds = new Set<number>();
let pendingAll = false;
let pendingMovies = false;
let emitTimer: ReturnType<typeof setTimeout> | null = null;

function queue(change: { showIds?: number[] | null; movies?: boolean }) {
  if (change.showIds === null) pendingAll = true;
  else for (const id of change.showIds ?? []) pendingShowIds.add(id);
  if (change.movies) pendingMovies = true;
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    const event: LiveSyncEvent = { showIds: pendingAll ? null : [...pendingShowIds], movies: pendingMovies };
    pendingAll = false;
    pendingMovies = false;
    pendingShowIds = new Set();
    if (event.showIds !== null && event.showIds.length === 0 && !event.movies) return;
    for (const l of listeners) l(event);
  }, EMIT_DEBOUNCE_MS);
}

function onWatchedChange(payload: {
  eventType: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}) {
  let showId: number | null = null;
  if (payload.eventType === "DELETE") {
    // Only the primary key comes through for a delete, and deletes can't be
    // filtered by user server-side — a row this device never loaded is
    // either someone else's or a show nobody has open, so nothing to update.
    const rowId = payload.old?.id;
    if (typeof rowId === "string") showId = findShowIdForWatchedRow(rowId);
  } else {
    const id = payload.new?.tvmaze_show_id;
    if (typeof id === "number") showId = id;
  }
  if (showId === null) return;
  if (Date.now() - lastLocalWatchedWrite(showId) < OWN_ECHO_WINDOW_MS) return;
  invalidateWatchedEpisodes(showId);
  queue({ showIds: [showId] });
}

function onUserShowChange(payload: {
  eventType: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}) {
  if (payload.eventType === "DELETE") {
    // Same primary-key-only delete as onWatchedChange — a show removed from
    // the list on another device is matched against this device's own
    // saved copy of the list (see fetchUserShows in lib/userShows.ts).
    const rowId = payload.old?.id;
    if (typeof rowId !== "string") return;
    getCachedUserShowsFast().then((rows) => {
      const row = rows?.find((r) => r.id === rowId);
      if (row) queue({ showIds: [row.tvmaze_id] });
    });
    return;
  }
  const id = payload.new?.tvmaze_id;
  if (typeof id !== "number") return;
  // Marking an episode watched also touches the show's row (status/
  // updated_at) — the same own-write echo as onWatchedChange.
  if (Date.now() - lastLocalWatchedWrite(id) < OWN_ECHO_WINDOW_MS) return;
  queue({ showIds: [id] });
}

function onMovieChange(payload: { eventType: string; old: Record<string, unknown> }) {
  if (payload.eventType === "DELETE") {
    const rowId = payload.old?.id;
    if (typeof rowId !== "string" || !isKnownMovieRow(rowId)) return;
  }
  // No own-echo check here: the Movies tab just refetches its two lists,
  // which is harmless after this device's own write.
  queue({ movies: true });
}

function onResume() {
  revalidateAllWatchedEpisodes();
  queue({ showIds: null, movies: true });
}

// Started once per signed-in session (context/AuthContext.tsx); returns the
// cleanup to run on sign-out.
export function startLiveSync(userId: string): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`live-sync:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "watched_episodes", filter: `user_id=eq.${userId}` },
      onWatchedChange
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "user_shows", filter: `user_id=eq.${userId}` },
      onUserShowChange
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "user_movies", filter: `user_id=eq.${userId}` },
      onMovieChange
    )
    .subscribe();

  let hiddenAt: number | null = null;
  let removeResume: () => void;
  if (Platform.OS === "web") {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null) {
        if (Date.now() - hiddenAt >= RESUME_MIN_HIDDEN_MS) onResume();
        hiddenAt = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    removeResume = () => document.removeEventListener("visibilitychange", onVisibility);
  } else {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        if (hiddenAt === null) hiddenAt = Date.now();
      } else if (hiddenAt !== null) {
        if (Date.now() - hiddenAt >= RESUME_MIN_HIDDEN_MS) onResume();
        hiddenAt = null;
      }
    });
    removeResume = () => sub.remove();
  }

  return () => {
    removeResume();
    supabase.removeChannel(channel);
  };
}

// Calls `onChange` whenever this user's data changed from elsewhere.
// `scope`: a show id to only hear about that show, "shows" for any show
// (the default), or "movies" for the user's movies. The "anything may have
// changed" resume event reaches every scope.
export function useLiveSync(onChange: (event: LiveSyncEvent) => void, scope: number | "shows" | "movies" = "shows") {
  const callbackRef = useRef(onChange);
  callbackRef.current = onChange;
  useEffect(() => {
    const listener: Listener = (event) => {
      if (scope === "movies") {
        if (!event.movies) return;
      } else if (event.showIds !== null) {
        if (scope === "shows" ? event.showIds.length === 0 : !event.showIds.includes(scope)) return;
      }
      callbackRef.current(event);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [scope]);
}
