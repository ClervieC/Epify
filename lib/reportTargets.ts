import { Ionicons } from "@expo/vector-icons";
import { fetchProfiles } from "./profiles";
import { fetchCommentsByIds } from "./comments";
import { fetchMovieCommentsByIds } from "./movieComments";
import { getShow, getEpisodeWithShow } from "./tvmaze";
import { mapWithConcurrency } from "./concurrency";
import { Report, ReportTargetType } from "./reports";
import { C } from "./adminTheme";

// Shared between app/admin/index.tsx (the reports list) and
// app/admin/reports/[id].tsx (one report's own ticket screen) — both need
// to turn a report's raw ids (reporter_id/target_user_id, TVmaze show/
// episode ids, comment ids) into a readable label and, where possible, a
// link to the actual thing being reported. Used to live only in the list
// screen; factored out once the detail screen needed the exact same
// resolution for a single report instead of duplicating ~150 lines of it.

export const TARGET_ICON: Record<ReportTargetType, keyof typeof Ionicons.glyphMap> = {
  user: "person-outline",
  comment: "chatbubble-outline",
  movie_comment: "chatbubble-outline",
  show: "tv-outline",
  episode: "film-outline",
  movie: "videocam-outline",
  general: "alert-circle-outline",
};

export const TARGET_COLOR: Record<ReportTargetType, string> = {
  user: C.red,
  comment: C.accent,
  movie_comment: C.accent,
  show: C.yellow,
  episode: C.yellow,
  movie: C.yellow,
  general: C.textMuted,
};

export interface EpisodeInfo {
  name: string;
  showName: string | null;
  showId: number;
}

export interface CommentInfo {
  body: string;
  authorName: string | null;
  // Lets the report card link through to whatever the comment is actually
  // on — a comment/movie_comment report has no tvmaze/tmdb id of its own on
  // the report row (see targetHref below), only this resolved lookup does.
  showId?: number; // comment (show/episode) only
  episodeId?: number | null; // comment (episode) only
  movieTmdbId?: number; // movie_comment only
}

export interface ResolvedReportTargets {
  userNames: Map<string, string>;
  showNames: Map<number, string>;
  episodeInfo: Map<number, EpisodeInfo>;
  commentInfo: Map<string, CommentInfo>;
  movieCommentInfo: Map<string, CommentInfo>;
}

// Best-effort, non-blocking by design — every targetSummary/targetHref call
// below already falls back to the raw id/number when a lookup is missing,
// so a failed fetch here just means a plainer label, not a broken screen.
export async function resolveReportTargets(reports: Report[]): Promise<ResolvedReportTargets> {
  const userIds = Array.from(
    new Set(reports.flatMap((r) => [r.reporter_id, r.target_user_id]).filter((id): id is string => !!id)),
  );
  const showIds = Array.from(
    new Set(
      reports.filter((r) => r.target_type === "show" && r.target_tvmaze_show_id != null).map((r) => r.target_tvmaze_show_id as number),
    ),
  );
  const episodeIds = Array.from(
    new Set(
      reports
        .filter((r) => r.target_type === "episode" && r.target_tvmaze_episode_id != null)
        .map((r) => r.target_tvmaze_episode_id as number),
    ),
  );
  const commentIds = Array.from(
    new Set(reports.filter((r) => r.target_type === "comment" && r.target_comment_id).map((r) => r.target_comment_id as string)),
  );
  const movieCommentIds = Array.from(
    new Set(
      reports
        .filter((r) => r.target_type === "movie_comment" && r.target_movie_comment_id)
        .map((r) => r.target_movie_comment_id as string),
    ),
  );

  const [profiles, showEntries, episodeEntries, comments, movieComments] = await Promise.all([
    fetchProfiles(userIds).catch(() => []),
    mapWithConcurrency(showIds, 5, (id) =>
      getShow(id)
        .then((show) => [id, show.name] as const)
        .catch(() => [id, null] as const),
    ),
    mapWithConcurrency(episodeIds, 5, (id) =>
      getEpisodeWithShow(id)
        .then((ep) => [id, { name: ep.name, showName: ep._embedded.show.name, showId: ep._embedded.show.id }] as const)
        .catch(() => [id, null] as const),
    ),
    fetchCommentsByIds(commentIds).catch(() => []),
    fetchMovieCommentsByIds(movieCommentIds).catch(() => []),
  ]);

  const showNames = new Map<number, string>();
  for (const [id, name] of showEntries) if (name) showNames.set(id, name);

  const episodeInfo = new Map<number, EpisodeInfo>();
  for (const [id, info] of episodeEntries) if (info) episodeInfo.set(id, info);

  const commentInfo = new Map<string, CommentInfo>();
  for (const c of comments) {
    commentInfo.set(c.id, { body: c.body, authorName: c.author?.username ?? null, showId: c.tvmaze_show_id, episodeId: c.tvmaze_episode_id });
  }

  const movieCommentInfo = new Map<string, CommentInfo>();
  for (const c of movieComments) {
    movieCommentInfo.set(c.id, { body: c.body, authorName: c.author?.username ?? null, movieTmdbId: c.tmdb_id });
  }

  return {
    userNames: new Map(profiles.map((p) => [p.user_id, p.username])),
    showNames,
    episodeInfo,
    commentInfo,
    movieCommentInfo,
  };
}

function commentSummary(label: string, info: CommentInfo | undefined, fallbackId: string | undefined): string {
  if (!info) return `${label} · ${fallbackId?.slice(0, 8)}`;
  const preview = info.body.length > 60 ? `${info.body.slice(0, 60)}…` : info.body;
  return info.authorName ? `${label} · ${info.authorName}: "${preview}"` : `${label} · "${preview}"`;
}

export function targetSummary(
  t: { targetUser: string; targetComment: string; targetMovieComment: string; targetShow: string; targetEpisode: string; targetMovie: string; targetGeneral: string },
  r: Report,
  targets: ResolvedReportTargets,
): string {
  switch (r.target_type) {
    case "user": {
      const name = r.target_user_id ? targets.userNames.get(r.target_user_id) : undefined;
      return `${t.targetUser} · ${name ?? r.target_user_id?.slice(0, 8)}`;
    }
    case "comment":
      return commentSummary(t.targetComment, r.target_comment_id ? targets.commentInfo.get(r.target_comment_id) : undefined, r.target_comment_id ?? undefined);
    case "movie_comment":
      return commentSummary(
        t.targetMovieComment,
        r.target_movie_comment_id ? targets.movieCommentInfo.get(r.target_movie_comment_id) : undefined,
        r.target_movie_comment_id ?? undefined,
      );
    case "show": {
      const name = r.target_tvmaze_show_id ? targets.showNames.get(r.target_tvmaze_show_id) : undefined;
      return name ? `${name} (#${r.target_tvmaze_show_id})` : `${t.targetShow} #${r.target_tvmaze_show_id}`;
    }
    case "episode": {
      const info = r.target_tvmaze_episode_id ? targets.episodeInfo.get(r.target_tvmaze_episode_id) : undefined;
      if (!info) return `${t.targetEpisode} #${r.target_tvmaze_episode_id}`;
      return `${info.showName ? `${info.showName} · ` : ""}${info.name} (#${r.target_tvmaze_episode_id})`;
    }
    case "movie":
      return `${t.targetMovie} #${r.target_tmdb_id}`;
    case "general":
      return t.targetGeneral;
  }
}

// Where tapping a report's target should navigate — same screens the app
// itself uses (show/episode/movie/user detail), so an admin can see exactly
// what was reported instead of only reading its resolved name. null when
// there's nothing to navigate to yet (id missing, or a comment whose own
// target hasn't resolved yet).
export type ReportTargetHref = string | { pathname: string; params: Record<string, string> };
export function targetHref(r: Report, targets: ResolvedReportTargets): ReportTargetHref | null {
  switch (r.target_type) {
    case "user":
      return r.target_user_id ? `/users/${r.target_user_id}` : null;
    case "show":
      return r.target_tvmaze_show_id ? `/show/${r.target_tvmaze_show_id}` : null;
    case "episode":
      return r.target_tvmaze_episode_id
        ? { pathname: "/episode/[id]", params: { id: String(r.target_tvmaze_episode_id), showId: String(r.target_tvmaze_show_id ?? "") } }
        : null;
    case "movie":
      return r.target_tmdb_id ? `/movie/tmdb/${r.target_tmdb_id}` : null;
    case "comment": {
      const info = r.target_comment_id ? targets.commentInfo.get(r.target_comment_id) : undefined;
      if (!info?.showId) return null;
      return info.episodeId ? { pathname: "/episode/[id]", params: { id: String(info.episodeId), showId: String(info.showId) } } : `/show/${info.showId}`;
    }
    case "movie_comment": {
      const info = r.target_movie_comment_id ? targets.movieCommentInfo.get(r.target_movie_comment_id) : undefined;
      return info?.movieTmdbId ? `/movie/tmdb/${info.movieTmdbId}` : null;
    }
    case "general":
      return null;
  }
}
