import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, getCurrentUserId } from "./supabase";
import { createShortCache } from "./shortCache";

// Admin badge count, polled on every navigation focus (see
// app/(tabs)/_layout.tsx) — same reasoning as lib/notifications.ts's
// unreadCountCache.
const openReportCountCache = createShortCache<number>(20_000);

// Called on sign-out (see context/AuthContext.tsx) — not scoped by user id.
export function clearOpenReportCountCache() {
  openReportCountCache.invalidate();
}

export type ReportTargetType = "user" | "comment" | "movie_comment" | "show" | "episode" | "movie" | "general";
export type ReportStatus = "open" | "resolved" | "dismissed";

export interface Report {
  id: string;
  reporter_id: string;
  target_type: ReportTargetType;
  target_user_id: string | null;
  target_comment_id: string | null;
  target_movie_comment_id: string | null;
  target_tvmaze_show_id: number | null;
  target_tvmaze_episode_id: number | null;
  target_tmdb_id: number | null;
  reason: string;
  image_urls: string[];
  status: ReportStatus;
  resolution_note: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
  // Legacy single reply field — superseded by the report_replies thread
  // below (see ReportReply/fetchReportReplies), never written to since. Left
  // populated on old rows so a report answered before the thread existed
  // still shows its answer (both app/reports/[id].tsx and
  // app/admin/reports/[id].tsx render it as a synthetic first bubble).
  admin_reply: string | null;
  admin_reply_at: string | null;
}

// Matches components/ReportModal.tsx's own limit — see supabase/schema.sql
// for why this isn't also enforced as a server-side check constraint.
export const MAX_REPORT_IMAGES = 5;

// `uri`/`mimeType` are whatever DocumentPicker handed back (see
// ReportModal.tsx), same as lib/profiles.ts's uploadAvatar. Unlike avatars
// (one fixed path, upsert), every report image gets its own path — a
// report can carry several, and unlike an avatar there's nothing to
// "replace." Storage path doesn't need to reference the report's own id at
// all (that only exists once createReport's insert below succeeds) — it
// just needs to be unique per upload, which Date.now() + the caller's own
// index already guarantees.
export async function uploadReportImage(uri: string, mimeType: string, index: number): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const response = await fetch(uri);
  const blob = await response.blob();
  const ext = mimeType.split("/")[1] ?? "jpg";
  const path = `${userId}/${Date.now()}-${index}.${ext}`;

  const { error } = await supabase.storage.from("report-images").upload(path, blob, { contentType: mimeType });
  if (error) throw error;

  const { data } = supabase.storage.from("report-images").getPublicUrl(path);
  return data.publicUrl;
}

// A single loosely-typed params object rather than one function per target
// type — every call site already knows exactly which target_type it's
// filing, and this keeps the "exactly one target_* column set" shape (see
// the schema's check-by-convention) in one place instead of five near-
// identical functions.
export interface CreateReportParams {
  targetType: ReportTargetType;
  reason: string;
  imageUrls?: string[];
  targetUserId?: string;
  targetCommentId?: string;
  targetMovieCommentId?: string;
  targetTvmazeShowId?: number;
  targetTvmazeEpisodeId?: number;
  targetTmdbId?: number;
}

export async function createReport(params: CreateReportParams): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { error } = await supabase.from("reports").insert({
    reporter_id: userId,
    target_type: params.targetType,
    reason: params.reason.trim(),
    image_urls: params.imageUrls ?? [],
    target_user_id: params.targetUserId ?? null,
    target_comment_id: params.targetCommentId ?? null,
    target_movie_comment_id: params.targetMovieCommentId ?? null,
    target_tvmaze_show_id: params.targetTvmazeShowId ?? null,
    target_tvmaze_episode_id: params.targetTvmazeEpisodeId ?? null,
    target_tmdb_id: params.targetTmdbId ?? null,
  });
  if (error) throw error;
}

// Everything below is admin-only — the RLS policies (see supabase/schema.sql)
// enforce that server-side too, so a non-admin calling these just gets an
// empty/rejected result rather than actually seeing anything.
export async function fetchOpenReportCount(): Promise<number> {
  return openReportCountCache.getOrFetch(async () => {
    const { count, error } = await supabase.from("reports").select("id", { count: "exact", head: true }).eq("status", "open");
    if (error) throw error;
    return count ?? 0;
  });
}

export async function fetchReports(status?: ReportStatus): Promise<Report[]> {
  let query = supabase.from("reports").select("*").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return data as Report[];
}

// For lib/notifications.ts's own enrichment pass — a type === "report_
// response" notification only carries the admin's reply (report_message),
// not what the original report was even about, so there was nothing on
// screen telling the reporter which of their reports a reply referred to.
// Safe to call with ids belonging to someone else's reports — "Users view
// their own reports" (see supabase/schema.sql) means those rows just don't
// come back, same as any other id a non-owner has no access to.
export async function fetchReportsByIds(ids: string[]): Promise<Report[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("reports").select("*").in("id", ids);
  if (error) throw error;
  return data as Report[];
}

// For app/reports/[id].tsx — a reporter viewing their own filed report in
// full (reason, photos, status, admin_reply), reached by tapping a
// report_response notification. Same RLS as fetchReportsByIds above: only
// ever returns a row the caller themselves filed, or an admin's own.
export async function fetchReportById(id: string): Promise<Report | null> {
  const { data, error } = await supabase.from("reports").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as Report | null;
}

export async function resolveReport(id: string, note: string | null): Promise<void> {
  const adminId = await getCurrentUserId();
  const { error } = await supabase
    .from("reports")
    .update({ status: "resolved", resolution_note: note, resolved_by: adminId, resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
  openReportCountCache.invalidate();
}

export async function dismissReport(id: string, note: string | null): Promise<void> {
  const adminId = await getCurrentUserId();
  const { error } = await supabase
    .from("reports")
    .update({ status: "dismissed", resolution_note: note, resolved_by: adminId, resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
  openReportCountCache.invalidate();
}

// A report's full conversation — turns reports from a one-shot "file a
// report, get at most one reply back" dead end into a real thread, mirroring
// lib/support.ts's SupportReply/support_message_replies exactly. reason
// stays the reporter's original message; every reply after that, from
// either side, is a row here.
export interface ReportReply {
  id: string;
  report_id: string;
  author_id: string;
  is_admin: boolean;
  body: string;
  created_at: string;
}

// Oldest first — rendered under the report's own reason/photos by both
// app/reports/[id].tsx (reporter) and app/admin/reports/[id].tsx (admin).
export async function fetchReportReplies(reportId: string): Promise<ReportReply[]> {
  const { data, error } = await supabase.from("report_replies").select("*").eq("report_id", reportId).order("created_at", { ascending: true });
  if (error) throw error;
  return data as ReportReply[];
}

// Admin-side reply (e.g. "fixed" / "can't reproduce this"), shown to the
// reporter as a notification — appends to the thread rather than
// overwriting a single field. Independent of resolve/dismiss: an admin can
// reply any time, before or after acting on the report. Goes through a
// security-definer RPC (see its own comment in supabase/schema.sql) since
// there's no insert policy letting a client write into someone else's
// notifications directly; returns the created row so the caller can append
// it to its own thread state without refetching.
export async function sendReportReply(reportId: string, message: string): Promise<ReportReply> {
  const { data, error } = await supabase.rpc("send_report_reply", { p_report_id: reportId, p_message: message.trim() });
  if (error) throw error;
  return data as ReportReply;
}

// Reporter-side reply — a follow-up on their own report. A reply on a
// report an admin had already resolved/dismissed reopens it (mirrors
// lib/support.ts's sendSupportReply) — without this, a follow-up question
// after a resolution silently vanished into a report no admin was still
// watching.
export async function sendReporterReply(reportId: string, body: string): Promise<ReportReply> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("report_replies")
    .insert({ report_id: reportId, author_id: userId, is_admin: false, body: body.trim() })
    .select()
    .single();
  if (error) throw error;

  await supabase.from("reports").update({ status: "open" }).eq("id", reportId).in("status", ["resolved", "dismissed"]);
  openReportCountCache.invalidate();

  return data as ReportReply;
}

// Live updates for one report's thread (app/reports/[id].tsx and
// app/admin/reports/[id].tsx both use this) — a channel per reportId,
// filtered server-side so only inserts for this specific report are
// delivered. The caller is responsible for deduping against its own
// optimistic insert (see mergeReportReply below) — this fires for every
// insert including the one the current device itself just made. Requires
// report_replies to be in the `supabase_realtime` publication (see
// supabase/schema.sql) — same self-hosted opt-in-per-table reasoning as
// lib/support.ts's subscribeToSupportReplies.
export function subscribeToReportReplies(reportId: string, onInsert: (reply: ReportReply) => void): RealtimeChannel {
  return supabase
    .channel(`report_replies:${reportId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "report_replies", filter: `report_id=eq.${reportId}` },
      (payload) => onInsert(payload.new as ReportReply)
    )
    .subscribe();
}

// Appends a reply arriving over realtime unless it's already present — see
// lib/support.ts's mergeReply for why this is needed (Realtime echoes the
// current device's own insert back to it).
export function mergeReportReply(prev: ReportReply[], incoming: ReportReply): ReportReply[] {
  if (prev.some((r) => r.id === incoming.id)) return prev;
  return [...prev, incoming];
}
