import * as Localization from "expo-localization";
import { supabase, getCurrentUserId } from "./supabase";

export type Language = "en" | "fr";

// Only en/fr exist as app languages (see Language above) — any other device
// locale (es, de, ja, ...) falls back to English rather than a language the
// app has no translations for at all.
export function getDeviceLanguage(): Language {
  return Localization.getLocales()[0]?.languageCode === "fr" ? "fr" : "en";
}

// 0 means the reminder is turned off. 6/12 are the only two choices offered
// during onboarding; Settings additionally offers turning it off.
export type StaleWatchlistMonths = 0 | 6 | 12;

export interface UserSettings {
  user_id: string;
  spoiler_mode: boolean;
  language: Language;
  stale_watchlist_months: StaleWatchlistMonths;
  show_feeling_prompt: boolean;
}

export async function fetchUserSettings(): Promise<UserSettings> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  // No row yet means no explicit preference has ever been saved — default to
  // the device's own language rather than always assuming English, same
  // reasoning LanguageProvider applies for signed-out screens (see lib/i18n.tsx).
  return (
    data ?? {
      user_id: userId,
      spoiler_mode: false,
      language: getDeviceLanguage(),
      stale_watchlist_months: 6,
      show_feeling_prompt: true,
    }
  );
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

export async function setShowFeelingPrompt(enabled: boolean) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: userId, show_feeling_prompt: enabled }, { onConflict: "user_id" });
  if (error) throw error;
}
