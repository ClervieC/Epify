import { supabase, getCurrentUserId } from "./supabase";

// Bookmarks for a show TVmaze doesn't have yet — see the schema comment on
// public.tmdb_only_shows in supabase/schema.sql for why this is a separate
// table from user_shows rather than a variant of it. No status, rating, or
// episode data of any kind: this is "I want to be able to find this again
// and get moved to real tracking once TVmaze has it", nothing more.
export interface TmdbOnlyShow {
  id: string;
  user_id: string;
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  created_at: string;
}

export async function fetchTmdbOnlyShows(): Promise<TmdbOnlyShow[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data, error } = await supabase
    .from("tmdb_only_shows")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as TmdbOnlyShow[];
}

export async function fetchTmdbOnlyShowByTmdbId(tmdbId: number): Promise<TmdbOnlyShow | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from("tmdb_only_shows")
    .select("*")
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function addTmdbOnlyShow(tmdbId: number, title: string, posterPath: string | null): Promise<TmdbOnlyShow> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("tmdb_only_shows")
    .upsert({ user_id: userId, tmdb_id: tmdbId, title, poster_path: posterPath }, { onConflict: "user_id,tmdb_id" })
    .select()
    .single();
  if (error) throw error;
  return data as TmdbOnlyShow;
}

export async function removeTmdbOnlyShow(tmdbId: number): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;

  const { error } = await supabase.from("tmdb_only_shows").delete().eq("user_id", userId).eq("tmdb_id", tmdbId);
  if (error) throw error;
}
