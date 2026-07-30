import { createAsyncStorage } from "@react-native-async-storage/async-storage";
import { UserMovie } from "./userMovies";

// Mirrors lib/watchingSnapshot.ts's role for the Shows tab: app/(tabs)/
// movies.tsx used to show a full-screen spinner on every cold launch until
// fetchUserMovies()/fetchMovieWatchlist() came back over the network, even
// though UserMovie rows are tiny and near-identical to what was on screen
// last time. This snapshot lets it paint instantly from disk instead, while
// the real reload() still runs and overwrites it as soon as it lands.
const storage = createAsyncStorage("movies_snapshot");
const STORAGE_KEY = "movies_snapshot_v1";

export interface MoviesSnapshot {
  movies: UserMovie[];
  watchlist: UserMovie[];
}

export async function saveMoviesSnapshot(snapshot: MoviesSnapshot): Promise<void> {
  try {
    await storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (err) {
    // Best-effort — a failed write just means the next cold launch falls
    // back to the network-only path.
    console.warn("saveMoviesSnapshot failed", err);
  }
}

export async function loadMoviesSnapshot(): Promise<MoviesSnapshot | null> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MoviesSnapshot;
  } catch (err) {
    console.warn("loadMoviesSnapshot failed", err);
    return null;
  }
}

// Called on sign-out (see context/AuthContext.tsx) — this key has no user id
// in it, so without clearing it, signing into a different account on the
// same device would briefly render the previous account's movies straight
// from disk before the fresh fetch for the new user overwrites it.
export async function clearMoviesSnapshot(): Promise<void> {
  try {
    await storage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort.
  }
}
