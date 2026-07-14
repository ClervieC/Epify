import { supabase, getCurrentUserId } from "./supabase";

export type Language = "en" | "fr";

// 0 means the reminder is turned off. 6/12 are the only two choices offered
// during onboarding; Settings additionally offers turning it off.
export type StaleWatchlistMonths = 0 | 6 | 12;

export interface UserSettings {
  user_id: string;
  spoiler_mode: boolean;
  language: Language;
  stale_watchlist_months: StaleWatchlistMonths;
}

export async function fetchUserSettings(): Promise<UserSettings> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data ?? { user_id: userId, spoiler_mode: false, language: "en", stale_watchlist_months: 6 };
}

export async function setSpoilerMode(enabled: boolean) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: userId, spoiler_mode: enabled }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function setLanguage(language: Language) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: userId, language }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function setStaleWatchlistMonths(months: StaleWatchlistMonths) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: userId, stale_watchlist_months: months }, { onConflict: "user_id" });
  if (error) throw error;
}
