import { supabase, getCurrentUserId } from "./supabase";
import { fetchUserSettings } from "./userSettings";

// One-time in-app nudge for shows that have sat in want_to_watch past the
// user's chosen threshold (asked once during onboarding, see app/onboarding.tsx,
// editable later in Settings). No push/cron infra exists in this app — this
// runs client-side on app open (see context/NotificationsContext.tsx) and
// inserts straight into public.notifications. The unique index on
// (user_id, tvmaze_show_id) (see supabase/schema.sql) makes the insert
// idempotent, so a show already reminded about is silently skipped on every
// later call rather than re-notified every session.
export async function checkStaleWatchlistReminders(): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;

  const settings = await fetchUserSettings();
  if (!settings.stale_watchlist_months) return;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - settings.stale_watchlist_months);

  const { data: shows, error } = await supabase
    .from("user_shows")
    .select("tvmaze_id, show_name, show_image")
    .eq("user_id", userId)
    .eq("status", "want_to_watch")
    .not("want_to_watch_since", "is", null)
    .lt("want_to_watch_since", cutoff.toISOString());
  if (error || !shows || shows.length === 0) return;

  const rows = shows.map((s) => ({
    user_id: userId,
    type: "stale_watchlist",
    tvmaze_show_id: s.tvmaze_id,
    show_name: s.show_name,
    show_image: s.show_image,
  }));

  await supabase
    .from("notifications")
    .upsert(rows, { onConflict: "user_id,tvmaze_show_id", ignoreDuplicates: true });
}
