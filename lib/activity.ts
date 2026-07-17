import { supabase, getCurrentUserId } from "./supabase";
import { fetchFollowingIds } from "./follows";
import { fetchProfiles, Profile } from "./profiles";
import { getCachedShow } from "./showDataCache";
import { getShow } from "./tvmaze";
import { getMovieDetails } from "./tmdb";

export type ActivityItem =
  | {
      kind: "episode_watched";
      id: string;
      user: Profile | null;
      createdAt: string;
      showId: number;
      showName: string;
      showImage: string | null;
      episodeId: number;
      season: number;
      number: number;
      rating: number | null;
      feeling: string | null;
    }
  | {
      kind: "movie_watched";
      id: string;
      user: Profile | null;
      createdAt: string;
      movieTitle: string;
      moviePosterPath: string | null;
      movieTmdbId: number | null;
      rating: number | null;
      feeling: string | null;
    }
  | {
      kind: "show_comment" | "episode_comment";
      id: string;
      user: Profile | null;
      createdAt: string;
      showId: number;
      showName: string;
      showImage: string | null;
      episodeId: number | null;
      body: string;
    }
  | {
      kind: "movie_comment";
      id: string;
      user: Profile | null;
      createdAt: string;
      movieTmdbId: number;
      movieTitle: string;
      moviePosterPath: string | null;
      body: string;
    };

// Fetched per table, not as a shared budget — the next PAGE_SIZE items
// overall could plausibly all come from just one of the four tables (e.g.
// someone binge-watching while nobody else comments), so each table needs
// its own full page of candidates for the merge below to have enough to
// work with. The four tables' combined pool (up to 4x this) is what gets
// sorted and sliced down to one page.
const PAGE_SIZE = 20;

// One feed combining everyone you follow's watch activity (episodes,
// movies — with whatever rating/feeling they left) and comments (show,
// episode, movie) — four independent tables with no shared "activity" log
// of their own, merged and re-sorted client-side by timestamp. Reactions
// (the heart-like on a comment) are deliberately left out: they have no
// body/timestamp worth surfacing on their own, and "reacted" in the
// feature request most naturally maps to the feeling emoji left alongside
// a rating, which watched items already carry.
//
// `before` is a keyset cursor (an ActivityItem's own createdAt, from the
// last page's oldest item) rather than an offset — an offset would shift
// under a paginating user as new activity keeps arriving from everyone they
// follow, silently skipping or repeating rows between pages.
export async function fetchFollowingActivity(before?: string): Promise<{ items: ActivityItem[]; hasMore: boolean }> {
  const myId = await getCurrentUserId();
  if (!myId) return { items: [], hasMore: false };

  const followingIds = await fetchFollowingIds(myId);
  if (followingIds.length === 0) return { items: [], hasMore: false };

  let watchedEpisodesQuery = supabase
    .from("watched_episodes")
    .select("*")
    .in("user_id", followingIds)
    .order("watched_at", { ascending: false })
    .limit(PAGE_SIZE);
  let watchedMoviesQuery = supabase
    .from("user_movies")
    .select("*")
    .in("user_id", followingIds)
    .eq("status", "watched")
    .order("watched_at", { ascending: false })
    .limit(PAGE_SIZE);
  let showCommentsQuery = supabase
    .from("comments")
    .select("*")
    .in("user_id", followingIds)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  let movieCommentsQuery = supabase
    .from("movie_comments")
    .select("*")
    .in("user_id", followingIds)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (before) {
    watchedEpisodesQuery = watchedEpisodesQuery.lt("watched_at", before);
    watchedMoviesQuery = watchedMoviesQuery.lt("watched_at", before);
    showCommentsQuery = showCommentsQuery.lt("created_at", before);
    movieCommentsQuery = movieCommentsQuery.lt("created_at", before);
  }

  const [watchedEpisodes, watchedMovies, showComments, movieComments] = await Promise.all([
    watchedEpisodesQuery,
    watchedMoviesQuery,
    showCommentsQuery,
    movieCommentsQuery,
  ]);
  if (watchedEpisodes.error) throw watchedEpisodes.error;
  if (watchedMovies.error) throw watchedMovies.error;
  if (showComments.error) throw showComments.error;
  if (movieComments.error) throw movieComments.error;

  // watched_episodes/comments only store a tvmaze_show_id, not the show's
  // name/image (unlike user_shows, which is the *current* user's own row —
  // not useful here since this is about people you follow) — TVmaze lookups
  // fill that in, via the same disk cache every other show-detail screen
  // already warms (see lib/showDataCache.ts), so repeat show ids across
  // several followed users' activity cost at most one network call each.
  const showIds = new Set<number>([
    ...watchedEpisodes.data.map((r: any) => r.tvmaze_show_id),
    ...showComments.data.map((r: any) => r.tvmaze_show_id),
  ]);
  const userIds = new Set<string>([
    ...watchedEpisodes.data.map((r: any) => r.user_id),
    ...watchedMovies.data.map((r: any) => r.user_id),
    ...showComments.data.map((r: any) => r.user_id),
    ...movieComments.data.map((r: any) => r.user_id),
  ]);

  // movie_comments has no title/poster of its own (unlike user_movies,
  // which has the *current* user's own row — not useful here), so those
  // need a TMDB lookup the same way show ids do above.
  const movieCommentTmdbIds = new Set<number>((movieComments.data as any[]).map((r) => r.tmdb_id));

  const [shows, movies, profiles] = await Promise.all([
    Promise.allSettled(
      Array.from(showIds).map(async (id) => [id, await getCachedShow(id, () => getShow(id))] as const)
    ),
    Promise.allSettled(
      Array.from(movieCommentTmdbIds).map(async (id) => [id, await getMovieDetails(id)] as const)
    ),
    fetchProfiles(Array.from(userIds)),
  ]);

  const showById = new Map<number, { name: string; image: string | null }>();
  for (const result of shows) {
    if (result.status === "fulfilled") {
      const [id, show] = result.value;
      showById.set(id, { name: show.name, image: show.image?.medium ?? null });
    }
  }
  const movieById = new Map<number, { title: string; posterPath: string | null }>();
  for (const result of movies) {
    if (result.status === "fulfilled") {
      const [id, movie] = result.value;
      movieById.set(id, { title: movie.title, posterPath: movie.poster_path });
    }
  }
  const profileById = new Map(profiles.map((p) => [p.user_id, p]));

  const items: ActivityItem[] = [];

  for (const row of watchedEpisodes.data as any[]) {
    const show = showById.get(row.tvmaze_show_id);
    items.push({
      kind: "episode_watched",
      id: `ew:${row.id}`,
      user: profileById.get(row.user_id) ?? null,
      createdAt: row.watched_at,
      showId: row.tvmaze_show_id,
      showName: show?.name ?? `#${row.tvmaze_show_id}`,
      showImage: show?.image ?? null,
      episodeId: row.tvmaze_episode_id,
      season: row.season,
      number: row.number,
      rating: row.rating,
      feeling: row.feeling,
    });
  }
  for (const row of watchedMovies.data as any[]) {
    if (!row.watched_at) continue;
    items.push({
      kind: "movie_watched",
      id: `mw:${row.id}`,
      user: profileById.get(row.user_id) ?? null,
      createdAt: row.watched_at,
      movieTitle: row.title,
      moviePosterPath: row.poster_path,
      movieTmdbId: row.tmdb_id,
      rating: row.rating,
      feeling: row.feeling,
    });
  }
  for (const row of showComments.data as any[]) {
    const show = showById.get(row.tvmaze_show_id);
    items.push({
      kind: row.target_type === "episode" ? "episode_comment" : "show_comment",
      id: `c:${row.id}`,
      user: profileById.get(row.user_id) ?? null,
      createdAt: row.created_at,
      showId: row.tvmaze_show_id,
      showName: show?.name ?? `#${row.tvmaze_show_id}`,
      showImage: show?.image ?? null,
      episodeId: row.tvmaze_episode_id,
      body: row.body,
    });
  }
  for (const row of movieComments.data as any[]) {
    const movie = movieById.get(row.tmdb_id);
    items.push({
      kind: "movie_comment",
      id: `mc:${row.id}`,
      user: profileById.get(row.user_id) ?? null,
      createdAt: row.created_at,
      movieTmdbId: row.tmdb_id,
      movieTitle: movie?.title ?? `#${row.tmdb_id}`,
      moviePosterPath: movie?.posterPath ?? null,
      body: row.body,
    });
  }

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  // A table that came back with a full page of candidates might have more
  // rows beyond it, even if none of them made this page's final cut (they
  // could all be older than the other tables' PAGE_SIZE-th item) — checking
  // the raw per-table results rather than just items.length > PAGE_SIZE
  // catches that case too.
  const hasMore =
    watchedEpisodes.data.length === PAGE_SIZE ||
    watchedMovies.data.length === PAGE_SIZE ||
    showComments.data.length === PAGE_SIZE ||
    movieComments.data.length === PAGE_SIZE;
  return { items: items.slice(0, PAGE_SIZE), hasMore };
}

// Cheap "is there anything new" check for the tab bar's red dot (see
// context/ActivityContext.tsx) — four single-row queries instead of
// fetchFollowingActivity()'s full fetch-and-enrich (show/movie lookups,
// profile joins), since all this needs is the single most recent timestamp
// across every table the feed draws from.
export async function fetchLatestFollowingActivityAt(): Promise<string | null> {
  const myId = await getCurrentUserId();
  if (!myId) return null;

  const followingIds = await fetchFollowingIds(myId);
  if (followingIds.length === 0) return null;

  const [watchedEpisode, watchedMovie, showComment, movieComment] = await Promise.all([
    supabase
      .from("watched_episodes")
      .select("watched_at")
      .in("user_id", followingIds)
      .order("watched_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("user_movies")
      .select("watched_at")
      .in("user_id", followingIds)
      .eq("status", "watched")
      .order("watched_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("comments")
      .select("created_at")
      .in("user_id", followingIds)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("movie_comments")
      .select("created_at")
      .in("user_id", followingIds)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const timestamps = [
    watchedEpisode.data?.watched_at,
    watchedMovie.data?.watched_at,
    showComment.data?.created_at,
    movieComment.data?.created_at,
  ].filter((v): v is string => !!v);

  if (timestamps.length === 0) return null;
  return timestamps.reduce((latest, t) => (new Date(t) > new Date(latest) ? t : latest));
}
