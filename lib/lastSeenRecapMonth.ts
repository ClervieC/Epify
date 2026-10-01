import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "last_seen_recap_month";

// Device-level, not tied to a user id — same convention as
// lib/lastSeenVersion.ts, just tracking "YYYY-MM" of the last month's recap
// this device has already been notified about (see
// components/NewMonthRecapToast.tsx) instead of a changelog version.
export async function getLastSeenRecapMonth(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function setLastSeenRecapMonth(monthKey: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, monthKey);
  } catch {
    // Best-effort — worst case the toast reappears next launch.
  }
}
