import { createAsyncStorage } from "@react-native-async-storage/async-storage";
import { UserShow, ShowList, ListItem } from "./userShows";
import { UserMovie } from "./userMovies";

// IndexedDB-backed (see the same comment in lib/showDataCache.ts and
// lib/watchingSnapshot.ts) — not the default AsyncStorage export, which is a
// much smaller localStorage-backed quota on web.
const storage = createAsyncStorage("profile_snapshot");
const STORAGE_KEY = "profile_snapshot_v1";

// Everything app/(tabs)/profile.tsx's load() fetches from Supabase on every
// visit — nine round trips today. Persisting the last result lets the
// screen paint instantly from disk on open (stats, favorites, lists) while
// that fresh fetch runs in the background, the same "seed from disk, then
// reconcile with the network" pattern lib/watchingSnapshot.ts uses for the
// Shows tab, applied here for the same reason: a cold/slow network shouldn't
// mean a blank Profile screen.
export interface ProfileSnapshot {
  shows: UserShow[];
  movies: UserMovie[];
  favoriteMovies: UserMovie[];
  favorites: UserShow[];
  lists: ShowList[];
  listItems: ListItem[];
  episodeCount: number;
}

export async function saveProfileSnapshot(snapshot: ProfileSnapshot): Promise<void> {
  try {
    await storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Best-effort — worst case the next open just waits on the network fetch,
    // same as before this cache existed.
  }
}

export async function loadProfileSnapshot(): Promise<ProfileSnapshot | null> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ProfileSnapshot;
  } catch {
    return null;
  }
}

// Called on sign-out (see context/AuthContext.tsx) — this key has no user id
// in it, so without clearing it, signing into a different account on the
// same device would briefly show the previous account's shows/movies/lists
// straight from disk before the fresh fetch overwrites it.
export async function clearProfileSnapshot(): Promise<void> {
  try {
    await storage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort.
  }
}
