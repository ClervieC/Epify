import { supabase, getCurrentUserId } from "./supabase";

export async function followUser(followedId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase.from("follows").insert({ follower_id: userId, followed_id: followedId });
  if (error) throw error;
}

export async function unfollowUser(followedId: string) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", userId)
    .eq("followed_id", followedId);
  if (error) throw error;
}

export async function fetchIsFollowing(followedId: string): Promise<boolean> {
  const userId = await getCurrentUserId();
  if (!userId) return false;

  const { data, error } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("follower_id", userId)
    .eq("followed_id", followedId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function fetchFollowCounts(userId: string) {
  const [followers, following] = await Promise.all([
    supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("followed_id", userId),
    supabase.from("follows").select("followed_id", { count: "exact", head: true }).eq("follower_id", userId),
  ]);
  if (followers.error) throw followers.error;
  if (following.error) throw following.error;
  return { followers: followers.count ?? 0, following: following.count ?? 0 };
}

export async function fetchFollowerIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from("follows").select("follower_id").eq("followed_id", userId);
  if (error) throw error;
  return data.map((row) => row.follower_id);
}

export async function fetchFollowingIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from("follows").select("followed_id").eq("follower_id", userId);
  if (error) throw error;
  return data.map((row) => row.followed_id);
}

export interface SuggestedBuddy {
  user_id: string;
  shared_count: number;
  match_percent: number;
}

// Backed by the suggested_show_buddies() Postgres function (see
// supabase/schema.sql) — it already excludes the caller and anyone they
// follow, and only returns people at or above the 10% overlap threshold, so
// there's nothing left to filter client-side.
export async function fetchSuggestedBuddies(limit = 20): Promise<SuggestedBuddy[]> {
  const { data, error } = await supabase.rpc("suggested_show_buddies", { p_limit: limit });
  if (error) throw error;
  return data as SuggestedBuddy[];
}

// Same shape and same rules as fetchSuggestedBuddies, over user_movies
// instead of user_shows (see suggested_movie_buddies() in
// supabase/schema.sql) — kept as a separate call/result set rather than
// merged server-side so the two match percentages can be shown to the user
// as two distinct numbers ("12 shows in common" / "5 movies in common")
// instead of one blended score that would hide which kind of taste actually
// overlaps.
export async function fetchSuggestedMovieBuddies(limit = 20): Promise<SuggestedBuddy[]> {
  const { data, error } = await supabase.rpc("suggested_movie_buddies", { p_limit: limit });
  if (error) throw error;
  return data as SuggestedBuddy[];
}
