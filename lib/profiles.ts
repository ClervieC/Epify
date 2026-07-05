import { supabase } from "./supabase";

export interface Profile {
  user_id: string;
  username: string;
}

export async function fetchMyProfile(): Promise<Profile | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createProfile(username: string): Promise<Profile> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("profiles")
    .insert({ user_id: userId, username })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchProfiles(userIds: string[]): Promise<Profile[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await supabase.from("profiles").select("*").in("user_id", userIds);
  if (error) throw error;
  return data;
}

export async function searchProfiles(query: string): Promise<Profile[]> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .ilike("username", `%${query}%`)
    .neq("user_id", userId ?? "")
    .limit(20);
  if (error) throw error;
  return data;
}
