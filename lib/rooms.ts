import { supabase, getCurrentUserId } from "./supabase";
import { fetchProfiles, Profile } from "./profiles";
import { getShow, getShowEpisodes, TVMazeShow } from "./tvmaze";
import { getCachedShow } from "./showDataCache";
import { posterUrl, TMDBSearchResult } from "./tmdb";
import { createShortCache } from "./shortCache";

export interface Room {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  expires_at: string | null;
  linked_tvmaze_show_id: number | null;
  // One emoji, picked from ROOM_EMOJIS below at creation — null falls back
  // to the room name's first letter, same as a person's Avatar falls back
  // to an initial when there's no photo.
  emoji: string | null;
}

// A small curated set rather than a full emoji keyboard — picking a room's
// identity is a once-at-creation, low-stakes choice, not something worth a
// native emoji picker integration for.
export const ROOM_EMOJIS = ["🎬", "🍿", "📺", "🎉", "🔥", "❤️", "👯", "🛋️", "🌙", "⭐"];

export interface RoomMember {
  room_id: string;
  user_id: string;
  status: "invited" | "accepted";
  invited_at: string;
  joined_at: string | null;
}

export interface RoomWithMembers extends Room {
  members: (RoomMember & { profile: Profile | null })[];
}

// What components/RoomSharePicker.tsx actually offers a choice between —
// one row per room, not per person (see its own comment for why: the
// picker used to flatten every room's members into one person-by-person
// list, which lost which room a target even belonged to).
export interface ShareableRoom {
  id: string;
  name: string;
  emoji: string | null;
  // Every other accepted member (self excluded) — what gets passed to
  // mark_episode_watched_for_room/mark_movie_watched_for_room when this
  // room is checked.
  memberUserIds: string[];
}

// Two ways to set a room's expires_at at creation time. Linking a room to a
// show (for the "Currently watching" progress section — see
// fetchLinkedShowProgress below) is a separate, independent choice from
// this — it used to also drive expires_at (the room would expire the moment
// an already-ended show's latest known episode air date was in the past,
// which meant a room linked to a finished show was "Ended" the instant it
// was created), so linking a show no longer touches expiry at all.
export type RoomExpiry = { kind: "none" } | { kind: "days"; days: number };

function resolveExpiresAt(expiry: RoomExpiry): string | null {
  if (expiry.kind === "days") {
    return new Date(Date.now() + expiry.days * 24 * 60 * 60 * 1000).toISOString();
  }
  return null;
}

export async function fetchMyRooms(): Promise<RoomWithMembers[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data: memberRows, error: memberError } = await supabase
    .from("room_members")
    .select("room_id")
    .eq("user_id", userId);
  if (memberError) throw memberError;
  const roomIds = [...new Set(memberRows.map((r) => r.room_id))];
  if (roomIds.length === 0) return [];

  const { data: rooms, error: roomsError } = await supabase
    .from("rooms")
    .select("*")
    .in("id", roomIds)
    .order("created_at", { ascending: false });
  if (roomsError) throw roomsError;

  const { data: allMembers, error: allMembersError } = await supabase
    .from("room_members")
    .select("*")
    .in("room_id", roomIds);
  if (allMembersError) throw allMembersError;

  const profiles = await fetchProfiles([...new Set((allMembers as RoomMember[]).map((m) => m.user_id))]);
  const profileById = new Map(profiles.map((p) => [p.user_id, p]));

  return (rooms as Room[]).map((room) => ({
    ...room,
    members: (allMembers as RoomMember[])
      .filter((m) => m.room_id === room.id)
      .map((m) => ({ ...m, profile: profileById.get(m.user_id) ?? null })),
  }));
}

export async function fetchRoom(roomId: string): Promise<RoomWithMembers | null> {
  const { data: room, error: roomError } = await supabase.from("rooms").select("*").eq("id", roomId).maybeSingle();
  if (roomError) throw roomError;
  if (!room) return null;

  const { data: members, error: membersError } = await supabase
    .from("room_members")
    .select("*")
    .eq("room_id", roomId);
  if (membersError) throw membersError;

  const profiles = await fetchProfiles((members as RoomMember[]).map((m) => m.user_id));
  const profileById = new Map(profiles.map((p) => [p.user_id, p]));

  return {
    ...(room as Room),
    members: (members as RoomMember[]).map((m) => ({ ...m, profile: profileById.get(m.user_id) ?? null })),
  };
}

export async function createRoom(
  name: string,
  expiry: RoomExpiry,
  emoji: string | null,
  linkedShowId: number | null,
): Promise<Room> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const expiresAt = resolveExpiresAt(expiry);
  const { data, error } = await supabase
    .from("rooms")
    .insert({ name, owner_id: userId, expires_at: expiresAt, linked_tvmaze_show_id: linkedShowId, emoji })
    .select()
    .single();
  if (error) throw error;
  shareableRoomsCache.invalidate();
  return data as Room;
}

// Owner-only (enforced by the "Owners update or delete their rooms" RLS
// policy on public.rooms, already in place for the delete half of that same
// policy) — the same fields createRoom sets at creation, now editable
// afterward so picking the wrong emoji or linking the wrong show doesn't
// mean recreating the room from scratch.
export async function updateRoom(
  roomId: string,
  name: string,
  expiry: RoomExpiry,
  emoji: string | null,
  linkedShowId: number | null,
): Promise<Room> {
  const expiresAt = resolveExpiresAt(expiry);
  const { data, error } = await supabase
    .from("rooms")
    .update({ name, expires_at: expiresAt, linked_tvmaze_show_id: linkedShowId, emoji })
    .eq("id", roomId)
    .select()
    .single();
  if (error) throw error;
  shareableRoomsCache.invalidate();
  return data as Room;
}

export async function inviteToRoom(roomId: string, userId: string) {
  const { error } = await supabase.from("room_members").insert({ room_id: roomId, user_id: userId });
  if (error) throw error;
}

export async function acceptRoomInvite(roomId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("room_members")
    .update({ status: "accepted", joined_at: new Date().toISOString() })
    .eq("room_id", roomId)
    .eq("user_id", userId);
  if (error) throw error;
  shareableRoomsCache.invalidate();
}

export async function declineRoomInvite(roomId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase.from("room_members").delete().eq("room_id", roomId).eq("user_id", userId);
  if (error) throw error;
}

export async function leaveRoom(roomId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase.from("room_members").delete().eq("room_id", roomId).eq("user_id", userId);
  if (error) throw error;
  shareableRoomsCache.invalidate();
}

// Owner-only — "Members leave or owners remove members" (supabase/
// schema.sql) already lets the owner delete any member's row, not just
// their own; this was just never exposed client-side until now. Same shape
// as leaveRoom, just targeting someone else.
export async function removeMember(roomId: string, userId: string) {
  const { error } = await supabase.from("room_members").delete().eq("room_id", roomId).eq("user_id", userId);
  if (error) throw error;
  shareableRoomsCache.invalidate();
}

export async function deleteRoom(roomId: string) {
  const { error } = await supabase.from("rooms").delete().eq("id", roomId);
  if (error) throw error;
  shareableRoomsCache.invalidate();
}

// Every accepted, non-expired room the caller belongs to, each with its
// other members — what components/RoomSharePicker.tsx offers a choice
// between (room by room, not a flattened list of people, so sharing stays
// attributable to a specific room — see components/RoomSharePicker.tsx and
// the room_watch_log table in supabase/schema.sql, which needs that same
// per-room attribution). Rooms with no other accepted member yet (everyone
// else still pending) are excluded — nothing useful to share with there.
// Mirrors lib/follows.ts's fetchFollowingIdsCached/createShortCache pattern
// (20s TTL), invalidated on create/accept/leave above so a just-formed room
// doesn't take up to 20s to start offering the share option.
const shareableRoomsCache = createShortCache<ShareableRoom[]>(20_000);

async function fetchShareableRooms(): Promise<ShareableRoom[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data: myRooms, error: myRoomsError } = await supabase
    .from("room_members")
    .select("room_id")
    .eq("user_id", userId)
    .eq("status", "accepted");
  if (myRoomsError) throw myRoomsError;
  const roomIds = [...new Set(myRooms.map((r) => r.room_id))];
  if (roomIds.length === 0) return [];

  const { data: rooms, error: roomsError } = await supabase
    .from("rooms")
    .select("id, name, emoji, expires_at")
    .in("id", roomIds);
  if (roomsError) throw roomsError;
  const activeRooms = (rooms as { id: string; name: string; emoji: string | null; expires_at: string | null }[]).filter(
    (r) => !r.expires_at || new Date(r.expires_at).getTime() > Date.now()
  );
  if (activeRooms.length === 0) return [];
  const activeRoomIds = activeRooms.map((r) => r.id);

  const { data: members, error: membersError } = await supabase
    .from("room_members")
    .select("room_id, user_id")
    .in("room_id", activeRoomIds)
    .eq("status", "accepted")
    .neq("user_id", userId);
  if (membersError) throw membersError;
  const membersByRoom = new Map<string, string[]>();
  for (const m of members as { room_id: string; user_id: string }[]) {
    const list = membersByRoom.get(m.room_id);
    if (list) list.push(m.user_id);
    else membersByRoom.set(m.room_id, [m.user_id]);
  }

  return activeRooms
    .map((r) => ({ id: r.id, name: r.name, emoji: r.emoji, memberUserIds: membersByRoom.get(r.id) ?? [] }))
    .filter((r) => r.memberUserIds.length > 0);
}

export function fetchShareableRoomsCached(): Promise<ShareableRoom[]> {
  return shareableRoomsCache.getOrFetch(fetchShareableRooms);
}

// Called on sign-out (see context/AuthContext.tsx) — not scoped by user id.
export function clearShareableRoomsCache() {
  shareableRoomsCache.invalidate();
}

export interface LinkedShowProgress {
  show: { id: number; name: string; imageUrl: string | null };
  // Aired episodes only — an unaired episode can't be "behind on" yet, so
  // it shouldn't count against anyone's denominator.
  totalEpisodes: number;
  memberProgress: { user_id: string; username: string; avatar_url: string | null; watchedCount: number }[];
}

// For a room linked to a show at creation (independent of its expiry — see
// RoomExpiry above) — the room detail screen's "Currently watching" section
// (app/rooms/[id].tsx), showing each member's progress through that one show
// side by side, since that's implicitly what the room is about. Returns null
// for a room with no linked show.
export async function fetchLinkedShowProgress(room: RoomWithMembers): Promise<LinkedShowProgress | null> {
  if (!room.linked_tvmaze_show_id) return null;
  const showId = room.linked_tvmaze_show_id;
  const [show, episodes] = await Promise.all([getCachedShow(showId, () => getShow(showId)), getShowEpisodes(showId)]);
  const totalEpisodes = episodes.filter((e) => !!e.airstamp && new Date(e.airstamp).getTime() <= Date.now()).length;

  const accepted = room.members.filter((m) => m.status === "accepted");
  const memberIds = accepted.map((m) => m.user_id);
  const { data, error } = await supabase
    .from("watched_episodes")
    .select("user_id")
    .eq("tvmaze_show_id", showId)
    .in("user_id", memberIds);
  if (error) throw error;
  const countByUser = new Map<string, number>();
  for (const row of data as { user_id: string }[]) {
    countByUser.set(row.user_id, (countByUser.get(row.user_id) ?? 0) + 1);
  }

  return {
    show: { id: show.id, name: show.name, imageUrl: show.image?.medium ?? null },
    totalEpisodes,
    memberProgress: accepted.map((m) => ({
      user_id: m.user_id,
      username: m.profile?.username ?? "?",
      avatar_url: m.profile?.avatar_url ?? null,
      watchedCount: countByUser.get(m.user_id) ?? 0,
    })),
  };
}

export interface RoomWatchLogEntry {
  id: string;
  room_id: string;
  shared_by: string;
  content_type: "episode" | "movie";
  tvmaze_show_id: number | null;
  tvmaze_episode_id: number | null;
  season: number | null;
  number: number | null;
  tmdb_id: number | null;
  movie_title: string | null;
  movie_year: number | null;
  movie_poster_path: string | null;
  created_at: string;
}

export async function fetchRoomWatchLog(roomId: string): Promise<RoomWatchLogEntry[]> {
  const { data, error } = await supabase
    .from("room_watch_log")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as RoomWatchLogEntry[];
}

// For lib/notifications.ts's own enrichment pass (a type === "room_share"
// notification carries room_watch_log_id, see notify_on_room_watch_log in
// supabase/schema.sql) — one batched lookup instead of one query per
// notification.
export async function fetchRoomWatchLogEntriesByIds(ids: string[]): Promise<Map<string, RoomWatchLogEntry>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("room_watch_log").select("*").in("id", ids);
  if (error) throw error;
  return new Map((data as RoomWatchLogEntry[]).map((e) => [e.id, e]));
}

export interface RoomWatchGroup {
  key: string;
  kind: "show" | "movie";
  title: string;
  imageUrl: string | null;
  tvmazeShowId?: number;
  tmdbId?: number;
  episodeCount: number;
  lastWatchedAt: string;
  // The individual log rows behind this group's count, oldest first — a
  // show's row expands to show exactly which episodes (app/rooms/[id].tsx),
  // each independently undoable. Not populated for movie groups — a movie
  // doesn't have sub-items the way a show's episodes do.
  entries: RoomWatchLogEntry[];
}

// Groups the flat log by show/movie — a binge session otherwise reads as a
// long run of near-identical lines ("Breaking Bad S1E1", "Breaking Bad
// S1E2", ...); one row per title with a count is what's actually useful on
// the room screen. Episode rows resolve their show's name/image through the
// same shared TVmaze cache every other screen already reads from
// (getCachedShow) — the log itself only stores ids (see the table's own
// comment in supabase/schema.sql).
export async function fetchGroupedRoomWatchLog(roomId: string): Promise<RoomWatchGroup[]> {
  const entries = await fetchRoomWatchLog(roomId);
  if (entries.length === 0) return [];

  const showIds = [
    ...new Set(entries.filter((e) => e.content_type === "episode" && e.tvmaze_show_id != null).map((e) => e.tvmaze_show_id!)),
  ];
  const shows = await Promise.all(
    showIds.map((id) =>
      getCachedShow(id, () => getShow(id)).catch(() => null)
    )
  );
  const showById = new Map(showIds.map((id, i) => [id, shows[i]]));

  const groups = new Map<string, RoomWatchGroup>();
  for (const e of entries) {
    const key = e.content_type === "episode" ? `show:${e.tvmaze_show_id}` : `movie:${e.tmdb_id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.episodeCount += 1;
      if (e.created_at > existing.lastWatchedAt) existing.lastWatchedAt = e.created_at;
      existing.entries.push(e);
      continue;
    }
    if (e.content_type === "episode") {
      const show = showById.get(e.tvmaze_show_id!);
      groups.set(key, {
        key,
        kind: "show",
        title: show?.name ?? "...",
        imageUrl: show?.image?.medium ?? null,
        tvmazeShowId: e.tvmaze_show_id!,
        episodeCount: 1,
        lastWatchedAt: e.created_at,
        entries: [e],
      });
    } else {
      groups.set(key, {
        key,
        kind: "movie",
        title: e.movie_title ?? "...",
        imageUrl: e.movie_poster_path ? posterUrl(e.movie_poster_path, "w200") : null,
        tmdbId: e.tmdb_id!,
        episodeCount: 1,
        lastWatchedAt: e.created_at,
        entries: [e],
      });
    }
  }
  for (const g of groups.values()) {
    g.entries.sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.number ?? 0) - (b.number ?? 0));
  }
  return [...groups.values()].sort((a, b) => (a.lastWatchedAt < b.lastWatchedAt ? 1 : -1));
}

// "We want to watch this together" — a lightweight shared queue, distinct
// from room_watch_log (what's already been watched together) and
// linked_tvmaze_show_id (a single show the room explicitly tracks
// progress on, set at creation/edit time). Any accepted member can add or
// remove their own entries; the owner can remove anyone's (see the RLS
// policies in supabase/schema.sql).
export interface RoomWatchlistEntry {
  id: string;
  room_id: string;
  added_by: string;
  content_type: "show" | "movie";
  tvmaze_show_id: number | null;
  tmdb_id: number | null;
  title: string;
  image_url: string | null;
  created_at: string;
}

export async function fetchRoomWatchlist(roomId: string): Promise<RoomWatchlistEntry[]> {
  const { data, error } = await supabase
    .from("room_watchlist")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as RoomWatchlistEntry[];
}

// Plain insert, not upsert — the uniqueness constraints on this table
// (room_watchlist_show_unique/_movie_unique in supabase/schema.sql) are
// *partial* indexes (content_type = 'show'/'movie'), and Postgres only
// matches an upsert's ON CONFLICT target against a partial index when the
// same predicate is repeated there too, which PostgREST's onConflict
// option has no way to express — it silently produces a plain ON CONFLICT
// (room_id, tvmaze_show_id) that matches no real constraint and fails.
// Catching the resulting unique-violation (23505) here instead — already
// on the list, nothing to do — gets the same "add or no-op" behavior a
// working upsert would have.
// Also queues the show on every accepted member's own personal watchlist
// (add_show_to_watchlist_for_room — a plain "insert if missing," so anyone
// who already has this show in their list in any status, including
// already watched, is left untouched). Run after the room_watchlist insert
// itself succeeds/no-ops, not in parallel — no point fanning out to every
// member's list for something that turned out to already be on the room's
// own list and wasn't really just added.
export async function addShowToRoomWatchlist(roomId: string, show: TVMazeShow): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");
  const { error } = await supabase.from("room_watchlist").insert({
    room_id: roomId,
    added_by: userId,
    content_type: "show",
    tvmaze_show_id: show.id,
    title: show.name,
    image_url: show.image?.medium ?? null,
  });
  if (error && error.code !== "23505") throw error;

  const { error: fanoutError } = await supabase.rpc("add_show_to_watchlist_for_room", {
    p_room_id: roomId,
    p_tvmaze_show_id: show.id,
    p_show_name: show.name,
    p_show_image: show.image?.medium ?? null,
  });
  if (fanoutError) throw fanoutError;
}

export async function addMovieToRoomWatchlist(roomId: string, movie: TMDBSearchResult): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");
  const { error } = await supabase.from("room_watchlist").insert({
    room_id: roomId,
    added_by: userId,
    content_type: "movie",
    tmdb_id: movie.id,
    title: movie.title,
    image_url: movie.poster_path,
  });
  if (error && error.code !== "23505") throw error;

  const year = movie.release_date ? Number(movie.release_date.slice(0, 4)) : null;
  const { error: fanoutError } = await supabase.rpc("add_movie_to_watchlist_for_room", {
    p_room_id: roomId,
    p_tmdb_id: movie.id,
    p_title: movie.title,
    p_year: year,
    p_poster_path: movie.poster_path,
  });
  if (fanoutError) throw fanoutError;
}

export async function removeFromRoomWatchlist(entryId: string): Promise<void> {
  const { error } = await supabase.from("room_watchlist").delete().eq("id", entryId);
  if (error) throw error;
}

// Undoes a "watched together" share — in case someone tapped it by
// mistake (see unmark_episodes_watched_for_room/unmark_movie_watched_
// for_room's own comment in supabase/schema.sql). Un-marks the whole
// group (every episode logged for this show in this room, not just the
// most recent share) as watched for every currently-accepted member, not
// just the caller — this is "undo what the room did," not a personal
// unwatch.
export async function unmarkWatchGroupForRoom(roomId: string, group: RoomWatchGroup): Promise<void> {
  if (group.kind === "show") {
    const { error } = await supabase.rpc("unmark_episodes_watched_for_room", {
      p_room_id: roomId,
      p_tvmaze_show_id: group.tvmazeShowId,
    });
    if (error) throw error;
  } else {
    const { error } = await supabase.rpc("unmark_movie_watched_for_room", {
      p_room_id: roomId,
      p_tmdb_id: group.tmdbId,
    });
    if (error) throw error;
  }
}

// Per-episode undo — narrower than unmarkWatchGroupForRoom above (which
// undoes every episode of a show at once); the room page's expanded
// per-episode list undoes one row at a time (see unmark_episode_watched_
// for_room's own comment in supabase/schema.sql).
export async function unmarkEpisodeFromRoom(roomId: string, tvmazeEpisodeId: number): Promise<void> {
  const { error } = await supabase.rpc("unmark_episode_watched_for_room", {
    p_room_id: roomId,
    p_tvmaze_episode_id: tvmazeEpisodeId,
  });
  if (error) throw error;
}

// Resolves a pending "did you rewatch this too?" notification (see
// confirm_room_rewatch's own comment in supabase/schema.sql) — surfaced
// when sharing an episode to the room that a target member already has
// marked watched, instead of silently bumping their count.
export async function respondToRewatchConfirm(confirmationId: string, confirmed: boolean): Promise<void> {
  const { error } = await supabase.rpc("confirm_room_rewatch", {
    p_confirmation_id: confirmationId,
    p_confirmed: confirmed,
  });
  if (error) throw error;
}
