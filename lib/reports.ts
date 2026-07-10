import { supabase, getCurrentUserId } from "./supabase";

export type ReportTargetType = "user" | "comment" | "movie_comment" | "show" | "episode" | "movie";
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
  status: ReportStatus;
  resolution_note: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

// A single loosely-typed params object rather than one function per target
// type — every call site already knows exactly which target_type it's
// filing, and this keeps the "exactly one target_* column set" shape (see
// the schema's check-by-convention) in one place instead of five near-
// identical functions.
export interface CreateReportParams {
  targetType: ReportTargetType;
  reason: string;
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
  const { count, error } = await supabase.from("reports").select("id", { count: "exact", head: true }).eq("status", "open");
  if (error) throw error;
  return count ?? 0;
}

export async function fetchReports(status?: ReportStatus): Promise<Report[]> {
  let query = supabase.from("reports").select("*").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return data as Report[];
}

export async function resolveReport(id: string, note: string | null): Promise<void> {
  const adminId = await getCurrentUserId();
  const { error } = await supabase
    .from("reports")
    .update({ status: "resolved", resolution_note: note, resolved_by: adminId, resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function dismissReport(id: string, note: string | null): Promise<void> {
  const adminId = await getCurrentUserId();
  const { error } = await supabase
    .from("reports")
    .update({ status: "dismissed", resolution_note: note, resolved_by: adminId, resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
