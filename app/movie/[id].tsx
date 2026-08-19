import { useCallback, useEffect, useRef, useState } from "react";
import { View, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import {
  fetchUserMovie,
  setMovieWatched,
  incrementMovieRewatch,
  decrementMovieRewatch,
  setMovieFavorite,
  rateMovie,
  fetchMovieFeelingCounts,
  UserMovie,
} from "../../lib/userMovies";
import {
  searchMovie,
  getMovieDetails,
  getMovieCast,
  getMovieTrailerUrl,
  getMovieWatchProviders,
  getMovieRecommendations,
  isMovieReleased,
  posterUrl,
  TMDBMovieDetails,
  TMDBCastMember,
  WatchProviders,
  TMDBSearchResult,
} from "../../lib/tmdb";
import { useLanguage } from "../../lib/i18n";
import { getCurrentUserId } from "../../lib/supabase";
import {
  fetchMovieComments,
  postMovieComment,
  deleteMovieComment,
  toggleMovieCommentReaction,
  EnrichedMovieComment,
} from "../../lib/movieComments";
import { Pill } from "../../components/Pill";
import { WatchedCheck } from "../../components/WatchedCheck";
import { MovieDetailView, MovieDetailLoading } from "../../components/MovieDetailView";
import { MovieRatingSection } from "../../components/MovieRatingSection";
import { RecommendationItem } from "../../components/RecommendationsRow";
import { useGoBack } from "../../lib/useGoBack";
import { DetailErrorState } from "../../components/DetailErrorState";

// user_movies (from the TV Time import, or added via Explore/the watchlist)
// only ever has a title/year, never a TMDB id for older rows, so the poster/
// synopsis/genres/runtime/cast below come from a live TMDB title search each
// time this screen opens (see lib/tmdb.ts — cached a day at a time so repeat
// visits are instant). The user's own watched-date/rewatch-count data is
// always shown immediately; TMDB's enrichment fills in a moment later
// without blocking on it, same as the show detail screen.
export default function MovieDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const goBack = useGoBack("/(tabs)/movies");
  const { t, language, spoilerMode } = useLanguage();

  const [movie, setMovie] = useState<UserMovie | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tmdb, setTmdb] = useState<TMDBMovieDetails | null>(null);
  const [tmdbNotFound, setTmdbNotFound] = useState(false);
  const [cast, setCast] = useState<TMDBCastMember[]>([]);
  const [trailerUrl, setTrailerUrl] = useState<string | null>(null);
  const [watchProviders, setWatchProviders] = useState<WatchProviders | null>(null);
  const [recommendations, setRecommendations] = useState<TMDBSearchResult[]>([]);
  // Bumped by every write to `movie` — both this reload and every mutation
  // handler below (handleRewatch, handleToggleFavorite, ...) — so that a
  // reload already in flight when a mutation lands (e.g. rating a movie
  // right after this screen refocuses) can tell its own fetch predates that
  // mutation and skip applying its now-stale result, instead of silently
  // reverting it a moment later.
  const movieVersionRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setLoadError(false);
      const myVersion = ++movieVersionRef.current;
      fetchUserMovie(id)
        .then((data) => {
          if (!active || movieVersionRef.current !== myVersion) return;
          if (!data) setLoadError(true);
          else setMovie(data);
        })
        .catch(() => active && movieVersionRef.current === myVersion && setLoadError(true))
        .finally(() => active && setLoading(false));
      return () => {
        active = false;
      };
    }, [id])
  );

  useEffect(() => {
    if (!movie) return;
    let active = true;
    setTmdb(null);
    setTmdbNotFound(false);
    setCast([]);
    searchMovie(movie.title, movie.year)
      .then((match) => {
        if (!active) return;
        if (!match) {
          setTmdbNotFound(true);
          return;
        }
        getMovieDetails(match.id).then((d) => active && setTmdb(d));
        getMovieCast(match.id)
          .then((c) => active && setCast(c))
          .catch(() => {});
        getMovieTrailerUrl(match.id)
          .then((url) => active && setTrailerUrl(url))
          .catch(() => {});
        getMovieWatchProviders(match.id, language)
          .then((p) => active && setWatchProviders(p))
          .catch(() => {});
        getMovieRecommendations(match.id)
          .then((r) => active && setRecommendations(r))
          .catch(() => {});
      })
      .catch(() => active && setTmdbNotFound(true));
    return () => {
      active = false;
    };
  }, [movie, language]);

  // Comments/feeling-counts are keyed by TMDB id — movie.tmdb_id if this row
  // already has one (the common case), otherwise whatever the title/year
  // search above resolved to. Legacy rows where neither is available (an old
  // TV Time import TMDB couldn't match) simply don't get these two social
  // features; rating/feeling still work either way, keyed by the row's own id.
  const commentTmdbId = movie?.tmdb_id ?? tmdb?.id ?? null;
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [comments, setComments] = useState<EnrichedMovieComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [feelingCounts, setFeelingCounts] = useState<Record<string, number>>({});
  // Same idea as movieVersionRef above, scoped to `comments` — posting a
  // comment ends with its own refetch-then-overwrite (see handlePostComment
  // below); without this, deleting or reacting to a *different* comment
  // while that post is still in flight gets silently reverted the moment
  // the post's refetch (which started before that delete/reaction) lands.
  const commentsVersionRef = useRef(0);

  // Spoiler-sensitive, same as episode detail — comments/feelings-tally load
  // early if spoiler mode is on, not just once the movie is actually watched.
  const unlocked = movie?.status === "watched" || spoilerMode;

  useEffect(() => {
    if (!unlocked || !commentTmdbId) return;
    let active = true;
    getCurrentUserId().then((uid) => active && setMyUserId(uid ?? null));
    setCommentsLoading(true);
    fetchMovieComments(commentTmdbId)
      .then((data) => active && setComments(data))
      .finally(() => active && setCommentsLoading(false));
    fetchMovieFeelingCounts(commentTmdbId).then((data) => active && setFeelingCounts(data));
    return () => {
      active = false;
    };
  }, [unlocked, commentTmdbId]);

  if (loadError) return <DetailErrorState onBack={goBack} />;
  if (loading || !movie) return <MovieDetailLoading onBack={goBack} />;

  const isWatched = movie.status === "watched";
  const notYetReleased = !!tmdb && !isMovieReleased(tmdb.release_date);
  const watchedDate = new Date(movie.watched_at ?? movie.created_at).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  async function handleToggleWatched() {
    if (isWatched) {
      // Rewatch prompt's "unwatch" choice — the row is gone, nothing left to
      // show here.
      await setMovieWatched(movie!.title, movie!.year, false);
      goBack();
    } else {
      if (notYetReleased) return;
      const updated = await setMovieWatched(
        movie!.title,
        movie!.year,
        true,
        movie!.tmdb_id ?? undefined,
        movie!.poster_path ?? tmdb?.poster_path
      );
      movieVersionRef.current++;
      setMovie(updated);
    }
  }
  async function handleRewatch() {
    const updated = await incrementMovieRewatch(movie!.id, movie!.times_watched);
    movieVersionRef.current++;
    setMovie(updated);
  }
  async function handleUndoRewatch() {
    const updated = await decrementMovieRewatch(movie!.id, movie!.times_watched);
    movieVersionRef.current++;
    setMovie(updated);
  }
  async function handleToggleFavorite() {
    const updated = await setMovieFavorite(movie!.id, !movie!.is_favorite);
    movieVersionRef.current++;
    setMovie(updated);
  }
  async function handleRate(value: number) {
    const next = movie!.rating === value ? null : value;
    const updated = await rateMovie(movie!.id, next, movie!.feeling);
    movieVersionRef.current++;
    setMovie(updated);
  }
  async function handleFeeling(key: string) {
    const next = movie!.feeling === key ? null : key;
    const updated = await rateMovie(movie!.id, movie!.rating, next);
    movieVersionRef.current++;
    setMovie(updated);
  }
  async function handlePostComment(body: string, parentId?: string) {
    if (!commentTmdbId) return;
    await postMovieComment(commentTmdbId, body, parentId);
    const myVersion = ++commentsVersionRef.current;
    const fresh = await fetchMovieComments(commentTmdbId);
    if (commentsVersionRef.current === myVersion) setComments(fresh);
  }
  function refreshComments() {
    if (!commentTmdbId) return;
    const myVersion = ++commentsVersionRef.current;
    fetchMovieComments(commentTmdbId).then((fresh) => {
      if (commentsVersionRef.current === myVersion) setComments(fresh);
    });
  }
  function handleDeleteComment(id: string) {
    commentsVersionRef.current++;
    setComments((prev) => prev.filter((c) => c.id !== id));
    deleteMovieComment(id).catch(refreshComments);
  }
  function handleToggleReaction(id: string, currentlyReacted: boolean) {
    commentsVersionRef.current++;
    setComments((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, reactedByMe: !currentlyReacted, reactionCount: c.reactionCount + (currentlyReacted ? -1 : 1) }
          : c
      )
    );
    toggleMovieCommentReaction(id, currentlyReacted).catch(refreshComments);
  }

  const recommendationItems: RecommendationItem[] = recommendations.map((r) => ({
    key: r.id,
    title: r.title,
    posterUrl: posterUrl(r.poster_path, "w200"),
    onPress: () => router.push(`/movie/tmdb/${r.id}`),
  }));

  return (
    <MovieDetailView
      title={movie.title}
      year={movie.year}
      tmdb={tmdb}
      tmdbNotFound={tmdbNotFound}
      cast={cast}
      tmdbId={commentTmdbId}
      trailerUrl={trailerUrl}
      watchProviders={watchProviders}
      recommendations={recommendationItems}
      onBack={goBack}
      isFavorite={movie.is_favorite}
      onToggleFavorite={handleToggleFavorite}
      watchedPills={
        <>
          <View style={styles.checkInline}>
            <WatchedCheck
              watched={isWatched}
              timesWatched={movie.times_watched}
              onToggle={handleToggleWatched}
              onRewatch={handleRewatch}
              onUndoRewatch={handleUndoRewatch}
              disabled={notYetReleased && !isWatched}
              size={26}
            />
          </View>
          {isWatched ? (
            <>
              <Pill>{t.movies.watchedOn(watchedDate)}</Pill>
              {movie.times_watched > 1 && <Pill tone="accent">{t.movies.watchCount(movie.times_watched)}</Pill>}
            </>
          ) : (
            <Pill tone="accent">{t.movies.inWatchlist}</Pill>
          )}
        </>
      }
      extraContent={
        <MovieRatingSection
          watched={isWatched}
          rating={movie.rating}
          feeling={movie.feeling}
          onRate={handleRate}
          onFeeling={handleFeeling}
          feelingCounts={feelingCounts}
          comments={comments}
          commentsLoading={commentsLoading}
          myUserId={myUserId}
          onSubmitComment={handlePostComment}
          onDeleteComment={handleDeleteComment}
          onToggleReaction={handleToggleReaction}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  checkInline: { alignSelf: "center" },
});
