import { supabase, getCurrentUserId } from "./supabase";
import { fetchFollowingIdsCached } from "./follows";
import { fetchProfiles, Profile } from "./profiles";
import { getCachedShow, peekCachedShow } from "./showDataCache";
import { getShow } from "./tvmaze";
import { getMovieDetails } from "./tmdb";
import { createShortCache } from "./shortCache";

// Same reasoning as lib/notifications.ts's unreadCountCache — the tab bar's
// red-dot poll re-fires on every navigation focus, throttled per-mount but
// not shared across screens.
const latestActivityAtCache = createShortCache<string | null>(20_000);

// Called on sign-out (see context/AuthContext.tsx) — not scoped by user id.
export function clearLatestActivityAtCache() {
  latestActivityAtCache.invalidate();
}

export type ActivityItem =
  | {
      kind: "episode_watched";
      id: string;
      userId: string;
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
      userId: string;
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
      userId: string;
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
      userId: string;
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
//
// Split into a fast pass (this function) and enrichActivityItems below,
// instead of one function that only returns once everyone's show names,
// movie titles, and profiles have all round-tripped — those are 2-3 extra
// network calls (TVmaze/TMDB for anything not already cached, plus a
// profiles query) that used to gate the very first paint of the whole
// screen. This pass only touches the 4 already-indexed, already-fast
// Supabase queries plus a synchronous in-memory cache peek for show names
// (see peekCachedShow) — nothing here should ever be the slow part. Pending
// ids are handed back alongside the items so the caller can enrich them in
// a second, non-blocking pass (see app/(tabs)/activity.tsx's load()).
export interface FollowingActivityPage {
  items: ActivityItem[];
  hasMore: boolean;
  pendingShowIds: number[];
  pendingMovieCommentTmdbIds: number[];
  pendingUserIds: string[];
}

export async function fetchFollowingActivity(before?: string): Promise<FollowingActivityPage> {
  const empty: FollowingActivityPage = { items: [], hasMore: false, pendingShowIds: [], pendingMovieCommentTmdbIds: [], pendingUserIds: [] };
  const myId = await getCurrentUserId();
  if (!myId) return empty;

  const followingIds = await fetchFollowingIdsCached(myId);
  if (followingIds.length === 0) return empty;

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

  // Whatever's already sitting in memory from earlier this session (the
  // user's own tracked shows, or a show already scrolled past in this same
  // feed) shows its real name/image immediately, at zero cost — everything
  // else falls back to a placeholder until the enrich pass fetches it for
  // real. See peekCachedShow's own comment for exactly what it does and
  // doesn't cover.
  const pendingShowIds = new Set<number>();
  function peekShow(showId: number): { name: string; image: string | null } | null {
    const cached = peekCachedShow(showId);
    if (cached) return { name: cached.name, image: cached.image?.medium ?? null };
    pendingShowIds.add(showId);
    return null;
  }

  const userIds = new Set<string>([
    ...watchedEpisodes.data.map((r: any) => r.user_id),
    ...watchedMovies.data.map((r: any) => r.user_id),
    ...showComments.data.map((r: any) => r.user_id),
    ...movieComments.data.map((r: any) => r.user_id),
  ]);
  // movie_comments has no title/poster of its own (unlike user_movies, which
  // has the *current* user's own row — not useful here), and there's no
  // local cache to peek the way peekCachedShow covers shows, so every one of
  // these always needs the enrich pass — movie_comment is a small enough
  // slice of a typical feed that this isn't worth its own cache layer.
  const movieCommentTmdbIds = new Set<number>((movieComments.data as any[]).map((r) => r.tmdb_id));

  const items: ActivityItem[] = [];

  for (const row of watchedEpisodes.data as any[]) {
    const show = peekShow(row.tvmaze_show_id);
    items.push({
      kind: "episode_watched",
      id: `ew:${row.id}`,
      userId: row.user_id,
      user: null,
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
      userId: row.user_id,
      user: null,
      createdAt: row.watched_at,
      movieTitle: row.title,
      moviePosterPath: row.poster_path,
      movieTmdbId: row.tmdb_id,
      rating: row.rating,
      feeling: row.feeling,
    });
  }
  for (const row of showComments.data as any[]) {
    const show = peekShow(row.tvmaze_show_id);
    items.push({
      kind: row.target_type === "episode" ? "episode_comment" : "show_comment",
      id: `c:${row.id}`,
      userId: row.user_id,
      user: null,
      createdAt: row.created_at,
      showId: row.tvmaze_show_id,
      showName: show?.name ?? `#${row.tvmaze_show_id}`,
      showImage: show?.image ?? null,
      episodeId: row.tvmaze_episode_id,
      body: row.body,
    });
  }
  for (const row of movieComments.data as any[]) {
    items.push({
      kind: "movie_comment",
      id: `mc:${row.id}`,
      userId: row.user_id,
      user: null,
      createdAt: row.created_at,
      movieTmdbId: row.tmdb_id,
      movieTitle: `#${row.tmdb_id}`,
      moviePosterPath: null,
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
  return {
    items: items.slice(0, PAGE_SIZE),
    hasMore,
    pendingShowIds: Array.from(pendingShowIds),
    pendingMovieCommentTmdbIds: Array.from(movieCommentTmdbIds),
    pendingUserIds: Array.from(userIds),
  };
}

// Second pass: fetches whatever fetchFollowingActivity's fast pass couldn't
// answer from memory alone (see its pending* return fields) and returns a
// NEW array with those items patched in place — profiles for every item
// (there's no local profile cache for other users to peek first), show
// names/images that weren't already warm, and movie_comment titles/posters.
// Matches by id, so it's safe to call against a page that's since grown
// (the user scrolled and loaded more) — anything not in the original
// pending lists is returned unchanged.
export async function enrichActivityItems(
  items: ActivityItem[],
  pending: { showIds: number[]; movieCommentTmdbIds: number[]; userIds: string[] }
): Promise<ActivityItem[]> {
  if (pending.showIds.length === 0 && pending.movieCommentTmdbIds.length === 0 && pending.userIds.length === 0) {
    return items;
  }

  const [shows, movies, profiles] = await Promise.all([
    Promise.allSettled(
      pending.showIds.map(async (id) => [id, await getCachedShow(id, () => getShow(id))] as const)
    ),
    Promise.allSettled(
      pending.movieCommentTmdbIds.map(async (id) => [id, await getMovieDetails(id)] as const)
    ),
    fetchProfiles(pending.userIds),
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

  return items.map((item): ActivityItem => {
    const user = item.user ?? profileById.get(item.userId) ?? null;
    switch (item.kind) {
      case "episode_watched":
      case "show_comment":
      case "episode_comment": {
        const show = showById.get(item.showId);
        return show ? { ...item, user, showName: show.name, showImage: show.image } : { ...item, user };
      }
      case "movie_comment": {
        const movie = movieById.get(item.movieTmdbId);
        return movie ? { ...item, user, movieTitle: movie.title, moviePosterPath: movie.posterPath } : { ...item, user };
      }
      case "movie_watched":
        return { ...item, user };
    }
  });
}

// Chunk size for enrichActivityItemsChunked below — small enough that the
// most recent handful of items (what's actually visible on screen first)
// resolve and paint almost immediately, without waiting on the whole page's
// worth of TVmaze/TMDB/profile lookups to land first.
const ENRICH_CHUNK_SIZE = 6;

function idsNeededFor(item: ActivityItem): { showId?: number; movieTmdbId?: number; userId: string } {
  switch (item.kind) {
    case "episode_watched":
    case "show_comment":
    case "episode_comment":
      return { showId: item.showId, userId: item.userId };
    case "movie_comment":
      return { movieTmdbId: item.movieTmdbId, userId: item.userId };
    case "movie_watched":
      return { userId: item.userId };
  }
}

// Same job as enrichActivityItems, but reveals items in small newest-first
// batches (via onChunk) instead of returning only once every pending id in
// the whole page has resolved — so a caller that waits to render until a
// chunk arrives never has to show a raw "#12345" show-id or a "?" avatar for
// an item that just hasn't been looked up yet. Splitting into per-chunk
// requests (rather than one shared showById/movieById/profileById map
// covering the whole page) means an id repeated across chunks is refetched
// per chunk instead of once — acceptable here since getCachedShow/
// fetchProfiles are themselves cache-backed, so a repeat is a cheap
// in-memory hit rather than a second network round trip.
export async function enrichActivityItemsChunked(
  items: ActivityItem[],
  pending: { showIds: number[]; movieCommentTmdbIds: number[]; userIds: string[] },
  onChunk: (chunk: ActivityItem[]) => void
): Promise<void> {
  if (items.length === 0) return;
  const pendingShowIds = new Set(pending.showIds);
  const pendingMovieIds = new Set(pending.movieCommentTmdbIds);
  const pendingUserIds = new Set(pending.userIds);

  for (let i = 0; i < items.length; i += ENRICH_CHUNK_SIZE) {
    const chunk = items.slice(i, i + ENRICH_CHUNK_SIZE);
    const showIds = new Set<number>();
    const movieCommentTmdbIds = new Set<number>();
    const userIds = new Set<string>();
    for (const item of chunk) {
      const needed = idsNeededFor(item);
      if (needed.showId != null && pendingShowIds.has(needed.showId)) showIds.add(needed.showId);
      if (needed.movieTmdbId != null && pendingMovieIds.has(needed.movieTmdbId)) movieCommentTmdbIds.add(needed.movieTmdbId);
      if (pendingUserIds.has(needed.userId)) userIds.add(needed.userId);
    }
    const enriched = await enrichActivityItems(chunk, {
      showIds: Array.from(showIds),
      movieCommentTmdbIds: Array.from(movieCommentTmdbIds),
      userIds: Array.from(userIds),
    });
    onChunk(enriched);
  }
}

// Cheap "is there anything new" check for the tab bar's red dot (see
// context/ActivityContext.tsx) — four single-row queries instead of
// fetchFollowingActivity()'s full fetch-and-enrich (show/movie lookups,
// profile joins), since all this needs is the single most recent timestamp
// across every table the feed draws from.
export async function fetchLatestFollowingActivityAt(): Promise<string | null> {
  return latestActivityAtCache.getOrFetch(() => fetchLatestFollowingActivityAtLive());
}

async function fetchLatestFollowingActivityAtLive(): Promise<string | null> {
  const myId = await getCurrentUserId();
  if (!myId) return null;

  const followingIds = await fetchFollowingIdsCached(myId);
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
