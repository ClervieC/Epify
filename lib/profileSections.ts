import AsyncStorage from "@react-native-async-storage/async-storage";

// Device-local UI preference (which Profile sections/custom lists are
// collapsed), same reasoning as lib/onboarding.ts's use of the default
// AsyncStorage rather than createAsyncStorage's IndexedDB variant — this is
// a couple of small string arrays, not the kind of cache that risks the
// localStorage quota.
const STORAGE_KEY = "profile_collapsed_v1";

interface CollapsedState {
  sections: string[];
  lists: string[];
}

export async function loadCollapsedProfileState(): Promise<{
  sections: Set<string>;
  lists: Set<string>;
}> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { sections: new Set(), lists: new Set() };
    const parsed = JSON.parse(raw) as CollapsedState;
    return { sections: new Set(parsed.sections ?? []), lists: new Set(parsed.lists ?? []) };
  } catch {
    return { sections: new Set(), lists: new Set() };
  }
}

export async function saveCollapsedProfileState(sections: Set<string>, lists: Set<string>): Promise<void> {
  try {
    const state: CollapsedState = { sections: [...sections], lists: [...lists] };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort — worst case the collapsed state doesn't survive a restart.
  }
}
