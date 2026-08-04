import { supabase, getCurrentUserId } from "./supabase";
import { fetchProfiles, Profile } from "./profiles";
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
  read: boolean;
  created_at: string;
}

export interface EnrichedNotification extends AppNotification {
  actor: Profile | null;
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
  const actors = await fetchProfiles(actorIds);
  const actorById = new Map(actors.map((a) => [a.user_id, a]));

  return data.map((n) => ({ ...n, actor: n.actor_id ? actorById.get(n.actor_id) ?? null : null }));
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
