import { supabase, getCurrentUserId } from "./supabase";
import { createShortCache } from "./shortCache";

export interface Profile {
  user_id: string;
  username: string;
  is_admin: boolean;
  is_banned: boolean;
  avatar_url: string | null;
}

// Called from AuthContext, the tab layout's admin gate, the Profile tab,
// Settings, and the admin screen — same "own profile" value fetched fresh
// independently by each. Rarely changes (only uploadAvatar mutates it, which
// invalidates below), so this can safely be a bit longer-lived than the
// pure poll caches above.
const myProfileCache = createShortCache<Profile | null>(30_000);

// Called on sign-out (see context/AuthContext.tsx) — not scoped by user id.
export function clearMyProfileCache() {
  myProfileCache.invalidate();
}

export async function fetchMyProfile(): Promise<Profile | null> {
  return myProfileCache.getOrFetch(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return null;

    const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return data;
  });
}

export async function createProfile(username: string): Promise<Profile> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("profiles")
    .insert({ user_id: userId, username })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Same constraint as the DB's own check (see "profiles" in supabase/
// schema.sql) — checked client-side first so a bad username shows an
// inline error instead of a round trip just to get rejected. The unique
// violation (another user already has it) can only be caught server-side,
// which is why this still lets Postgres's own error surface on conflict.
export const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

export async function updateUsername(username: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase.from("profiles").update({ username }).eq("user_id", userId);
  if (error) throw error;
  myProfileCache.invalidate();
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
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .ilike("username", `%${query}%`)
    .neq("user_id", userId ?? "")
    .limit(20);
  if (error) throw error;
  return data;
}

// Admin-only in practice (RLS lets anyone select any profile, but only an
// admin's own update policy can flip is_banned — see supabase/schema.sql).
export async function fetchAllProfilesForAdmin(query: string): Promise<Profile[]> {
  let q = supabase.from("profiles").select("*").order("username", { ascending: true }).limit(50);
  if (query.trim()) q = q.ilike("username", `%${query.trim()}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function setUserBanned(userId: string, banned: boolean): Promise<void> {
  const { error } = await supabase.from("profiles").update({ is_banned: banned }).eq("user_id", userId);
  if (error) throw error;
}

// Promote/demote — same "Admins update any profile" RLS policy already
// covers this column, no schema change needed. Separate from setUserBanned
// since they're independent axes (an admin can still be suspended, though
// the UI disables that combination — see app/admin/index.tsx's UserCard).
export async function setUserAdmin(userId: string, isAdmin: boolean): Promise<void> {
  const { error } = await supabase.from("profiles").update({ is_admin: isAdmin }).eq("user_id", userId);
  if (error) throw error;
}

async function uriToBlob(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  return response.blob();
}

// `uri` is the cropped square from components/AvatarCropper.tsx — a local
// file:// URI on native, a blob:/data: URI on web. fetch() reads either into
// a Blob uniformly, which is what supabase-js's storage upload wants.
// Always uploaded to the same fixed path (not one per photo) with upsert — a
// user only ever has one current avatar, so nothing but the current one
// needs to stick around in the bucket, and this dodges the "old image still
// cached under the old URL" problem an ever-growing path would have (see the
// cache-busting query param below instead).
//
// `original` is the uncropped photo it was cut from, kept next to it so
// "Reposition photo" can re-crop from the full image later (zooming back
// out, moving to a part the current crop cut off) instead of only ever
// being able to zoom further into the already-cropped square. Omitted when
// re-cropping, since the original stored last time is still the right one.
export async function uploadAvatar(
  uri: string,
  mimeType: string,
  original?: { uri: string; mimeType: string },
): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const ext = mimeType.split("/")[1] ?? "jpg";
  const fileName = `avatar.${ext}`;
  const path = `${userId}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, await uriToBlob(uri), { contentType: mimeType, upsert: true });
  if (uploadError) throw uploadError;

  if (original) {
    // Best-effort — the avatar itself already succeeded; without the
    // original, repositioning just falls back to the cropped image.
    await supabase.storage
      .from("avatars")
      .upload(`${userId}/${AVATAR_ORIGINAL}`, await uriToBlob(original.uri), {
        contentType: original.mimeType,
        upsert: true,
      })
      .catch(() => {});
  }

  // Avatars uploaded before cropping existed kept the picked file's own
  // extension (avatar.png, avatar.heic, ...) — now always a JPEG, so an
  // older one under a different name would otherwise linger forever.
  const { data: files } = await supabase.storage.from("avatars").list(userId);
  const stale = (files ?? [])
    .filter((f) => f.name.startsWith("avatar.") && f.name !== fileName)
    .map((f) => `${userId}/${f.name}`);
  if (stale.length > 0) await supabase.storage.from("avatars").remove(stale);

  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  // Cache-busting: the URL itself doesn't change across re-uploads (fixed
  // path + upsert), so without this a client that already cached the old
  // image (its own, or another user viewing this profile) would keep
  // showing it after a new photo is uploaded.
  const avatarUrl = `${data.publicUrl}?v=${Date.now()}`;

  const { error: updateError } = await supabase.from("profiles").update({ avatar_url: avatarUrl }).eq("user_id", userId);
  if (updateError) throw updateError;
  myProfileCache.invalidate();

  return avatarUrl;
}

const AVATAR_ORIGINAL = "original";

// The uncropped photo uploadAvatar stored alongside the avatar, or null for
// avatars set before that existed (the caller re-crops the avatar itself
// then). Cache-busted the same way as the avatar, since it's also a fixed
// path overwritten in place.
export async function fetchAvatarOriginalUrl(): Promise<string | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const { data: files } = await supabase.storage.from("avatars").list(userId);
  const original = (files ?? []).find((f) => f.name === AVATAR_ORIGINAL);
  if (!original) return null;
  const { data } = supabase.storage.from("avatars").getPublicUrl(`${userId}/${AVATAR_ORIGINAL}`);
  return `${data.publicUrl}?v=${encodeURIComponent(original.updated_at ?? Date.now())}`;
}

// Back to the initial-letter avatar — clears the profile column first (what
// every screen actually reads), then deletes the files (avatar + original)
// so nothing of the photo stays in the public bucket.
export async function removeAvatar(): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error: updateError } = await supabase.from("profiles").update({ avatar_url: null }).eq("user_id", userId);
  if (updateError) throw updateError;
  myProfileCache.invalidate();

  const { data: files } = await supabase.storage.from("avatars").list(userId);
  const paths = (files ?? []).map((f) => `${userId}/${f.name}`);
  if (paths.length > 0) await supabase.storage.from("avatars").remove(paths);
}
