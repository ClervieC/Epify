import { Platform, Share } from "react-native";
import { supabase, getCurrentUserId } from "./supabase";
import { fetchFollowerIds, fetchFollowingIds } from "./follows";
import { fetchProfiles, Profile } from "./profiles";

// Where shared links point. On web, whatever origin the app is actually
// served from (a preview deploy shares its own URL); native builds have no
// origin of their own, so they link to the production site.
const PRODUCTION_ORIGIN = "https://epify-clervie.vercel.app";

function siteOrigin(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin;
  return PRODUCTION_ORIGIN;
}

export type ShareTarget =
  | { kind: "show"; showId: number; showName: string; showImage: string | null }
  | {
      kind: "episode";
      showId: number;
      showName: string;
      showImage: string | null;
      episodeId: number;
      season: number;
      number: number;
      episodeName: string;
    };

export function episodeCode(season: number, number: number): string {
  return `S${String(season).padStart(2, "0")}E${String(number).padStart(2, "0")}`;
}

// The episode screen needs showId alongside the episode id (see
// app/episode/[id].tsx's useLocalSearchParams), so it's part of the link.
export function shareUrl(target: ShareTarget): string {
  if (target.kind === "show") return `${siteOrigin()}/show/${target.showId}`;
  return `${siteOrigin()}/episode/${target.episodeId}?showId=${target.showId}`;
}

export function shareTitle(target: ShareTarget): string {
  if (target.kind === "show") return target.showName;
  return `${target.showName} — ${episodeCode(target.season, target.number)} · ${target.episodeName}`;
}

// Copies the link. Native builds don't ship a clipboard module, but their
// system share sheet (shareViaSystem below) already has "Copy" in it — so
// this is only offered on web. Returns false when the browser refuses
// (non-secure context, permission denied).
export async function copyShareLink(target: ShareTarget): Promise<boolean> {
  if (Platform.OS !== "web" || typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(shareUrl(target));
    return true;
  } catch {
    return false;
  }
}

// The OS share sheet (Messages, WhatsApp, …). On web that's navigator.share,
// which desktop browsers mostly lack — there the caller falls back to
// copying the link instead. Returns false only when nothing could be opened;
// the user cancelling the sheet counts as handled.
export async function shareViaSystem(target: ShareTarget): Promise<boolean> {
  const url = shareUrl(target);
  const title = shareTitle(target);
  if (Platform.OS === "web") {
    if (typeof navigator === "undefined" || !navigator.share) return false;
    try {
      await navigator.share({ title, url });
    } catch {
      // AbortError when the user closes the sheet — nothing to do.
    }
    return true;
  }
  // iOS shows `url` as a proper link preview; Android ignores it, so the
  // link also goes in the message there.
  await Share.share(Platform.OS === "ios" ? { message: title, url } : { message: `${title}\n${url}` });
  return true;
}

// Who can be sent something directly: anyone you follow or who follows you
// — the same set share_with_users accepts server-side.
export async function fetchShareCandidates(): Promise<Profile[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  const [following, followers] = await Promise.all([fetchFollowingIds(userId), fetchFollowerIds(userId)]);
  const ids = [...new Set([...following, ...followers])].filter((id) => id !== userId);
  const profiles = await fetchProfiles(ids);
  return profiles
    .filter((p) => !p.is_banned)
    .sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: "base" }));
}

export async function shareWithUsers(target: ShareTarget, userIds: string[], message: string): Promise<void> {
  const { error } = await supabase.rpc("share_with_users", {
    p_recipient_ids: userIds,
    p_show_id: target.showId,
    p_show_name: target.showName,
    p_show_image: target.showImage,
    p_episode_id: target.kind === "episode" ? target.episodeId : null,
    p_season: target.kind === "episode" ? target.season : null,
    p_number: target.kind === "episode" ? target.number : null,
    p_episode_name: target.kind === "episode" ? target.episodeName : null,
    p_message: message.trim() || null,
  });
  if (error) throw error;
}
