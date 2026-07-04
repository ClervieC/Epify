import { supabase } from "./supabase";

export interface UserMovie {
  id: string;
  user_id: string;
  title: string;
  year: number | null;
  watched_at: string;
  times_watched: number;
  created_at: string;
  updated_at: string;
}

export async function fetchUserMovies() {
  const { data, error } = await supabase
    .from("user_movies")
    .select("*")
    .order("watched_at", { ascending: false });
  if (error) throw error;
  return data as UserMovie[];
}

export async function bulkUpsertUserMovies(
  movies: { title: string; year: number | null; watchedAt: string; timesWatched: number }[]
) {
  if (movies.length === 0) return;
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const CHUNK_SIZE = 300;
  for (let i = 0; i < movies.length; i += CHUNK_SIZE) {
    const chunk = movies.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from("user_movies").upsert(
      chunk.map((m) => ({
        user_id: userId,
        title: m.title,
        year: m.year,
        watched_at: m.watchedAt,
        times_watched: m.timesWatched,
      })),
      { onConflict: "user_id,title,year" }
    );
    if (error) throw error;
  }
}
