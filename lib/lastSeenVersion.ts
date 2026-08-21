import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "last_seen_changelog_version";

// Device-level, not tied to a user id — just tracks whether *this device*
// has opened the What's New screen for the latest version, so the Settings
// badge (see app/settings.tsx) knows whether to show a "new" dot.
export async function getLastSeenChangelogVersion(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function setLastSeenChangelogVersion(version: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, version);
  } catch {
    // Best-effort — worst case the badge reappears next launch.
  }
}
