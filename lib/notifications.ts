import { supabase, getCurrentUserId } from "./supabase";
import { fetchProfiles, Profile } from "./profiles";
import { fetchRoomWatchLogEntriesByIds, RoomWatchLogEntry } from "./rooms";
import { fetchReportsByIds } from "./reports";
import { getCachedShow } from "./showDataCache";
import { getShow } from "./tvmaze";
import { createShortCache } from "./shortCache";

// NotificationsContext's own focus-triggered poll already throttles to once
// per 10s, but that throttle is per-mount, not shared — every screen the
// user navigates through re-triggers it independently. This cache collapses
// those into one real network round trip every 20s regardless of how many
// times navigation re-fires the poll in that window.
const unreadCountCache = createShortCache<number>(20_000);

// Called on sign-out (see context/AuthContext.tsx) — this cache isn't
// scoped by user id, so without clearing it, signing into a different
// account could briefly show the previous account's unread count.
export function clearUnreadNotificationCountCache() {
  unreadCountCache.invalidate();
}

export interface AppNotification {
  id: string;
  user_id: string;
  type: string;
  actor_id: string | null;
  // Only set for type === "stale_watchlist" (see lib/staleWatchlist.ts) —
  // null for every other (social) notification type.
  tvmaze_show_id: number | null;
  show_name: string | null;
  show_image: string | null;
  // Set for type === "room_invite" (see notify_on_room_invite in supabase/
  // schema.sql) and type === "room_share" (notify_on_room_watch_log) — null
  // for every other type, same sparse-column convention as tvmaze_show_id/
  // show_name above.
  room_id: string | null;
  room_name: string | null;
  // Only set for type === "room_share" — which share this notification is
  // about (see notify_on_room_watch_log in supabase/schema.sql). When the
  // underlying share covered more than one episode (a season marked watched
  // in one go), room_watch_log_id points at just one representative row of
  // the group — room_watch_episode_count is what tells the UI this was a
  // season, not a single episode, and to word/link it accordingly.
  room_watch_log_id: string | null;
  room_watch_episode_count: number;
  // Set for type === "report_response" (see send_report_reply in supabase/
  // schema.sql) — an admin's reply to a report this user filed. null for
  // every other type, same sparse-column convention as the room_*/
  // tvmaze_show_id columns above.
  report_id: string | null;
  report_message: string | null;
  read: boolean;
  created_at: string;
}

export interface EnrichedNotification extends AppNotification {
  actor: Profile | null;
  roomWatchLog: RoomWatchLogEntry | null;
  // Resolved only for an episode-type roomWatchLog — the log itself only
  // stores tvmaze_show_id (see its own comment in supabase/schema.sql), so
  // rendering "X marked [Show] S1E2 watched" needs this looked up, same
  // shared cache every other screen already reads the show's name from.
  roomWatchLogShowName: string | null;
  // Only set for type === "report_response" — the original report's own
  // reason text, so a reply reads as "Reply to your report ('the app
  // crashes when...'): fixed!" instead of just the reply on its own with
  // nothing saying which report it was about. null if the report was
  // since deleted (report_id cascades) or hasn't resolved yet.
  reportReason: string | null;
}

export async function fetchNotifications(): Promise<EnrichedNotification[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;

  const actorIds = [...new Set(data.map((n) => n.actor_id).filter((id): id is string => !!id))];
  const logIds = [...new Set(data.map((n) => n.room_watch_log_id).filter((id): id is string => !!id))];
  const reportIds = [...new Set(data.map((n) => n.report_id).filter((id): id is string => !!id))];
  const [actors, logById, reports] = await Promise.all([
    fetchProfiles(actorIds),
    fetchRoomWatchLogEntriesByIds(logIds),
    fetchReportsByIds(reportIds),
  ]);
  const actorById = new Map(actors.map((a) => [a.user_id, a]));
  const reportById = new Map(reports.map((r) => [r.id, r]));

  const episodeShowIds = [
    ...new Set(
      [...logById.values()].filter((e) => e.content_type === "episode" && e.tvmaze_show_id != null).map((e) => e.tvmaze_show_id!)
    ),
  ];
  const shows = await Promise.all(episodeShowIds.map((id) => getCachedShow(id, () => getShow(id)).catch(() => null)));
  const showNameById = new Map(episodeShowIds.map((id, i) => [id, shows[i]?.name ?? null]));

  return data.map((n) => {
    const log = n.room_watch_log_id ? logById.get(n.room_watch_log_id) ?? null : null;
    return {
      ...n,
      actor: n.actor_id ? actorById.get(n.actor_id) ?? null : null,
      roomWatchLog: log,
      roomWatchLogShowName: log?.tvmaze_show_id != null ? showNameById.get(log.tvmaze_show_id) ?? null : null,
      reportReason: n.report_id ? reportById.get(n.report_id)?.reason ?? null : null,
    };
  });
}

export async function fetchUnreadNotificationCount(): Promise<number> {
  return unreadCountCache.getOrFetch(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return 0;

    const { count, error } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("read", false);
    if (error) throw error;
    return count ?? 0;
  });
}

export async function markAllNotificationsRead() {
  const userId = await getCurrentUserId();
  if (!userId) return;

  const { error } = await supabase.from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false);
  if (error) throw error;
  unreadCountCache.invalidate();
}
