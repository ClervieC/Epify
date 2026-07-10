import { useCallback, useRef, useState } from "react";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import {
  getTvDetails,
  getTvCast,
  getTvTrailerUrl,
  getTvWatchProviders,
  getTvRecommendations,
  findTvmazeShowFromTmdbTv,
  posterUrl,
  TMDBTvDetails,
  TMDBCastMember,
  WatchProviders,
  TMDBTvResult,
} from "../../../lib/tmdb";
import { useLanguage } from "../../../lib/i18n";
import { MovieDetailView, MovieDetailLoading } from "../../../components/MovieDetailView";
import { RecommendationItem } from "../../../components/RecommendationsRow";
import { Pill } from "../../../components/Pill";
import {
  fetchTmdbOnlyShowByTmdbId,
  addTmdbOnlyShow,
  removeTmdbOnlyShow,
  TmdbOnlyShow,
} from "../../../lib/tmdbOnlyShows";
import { upsertUserShow } from "../../../lib/userShows";
import { useGoBack } from "../../../lib/useGoBack";

// Reached when a show has no TVmaze match (see the "no match" fallback in
// app/show/[id].tsx's recommendation taps and app/(tabs)/explore.tsx's
// resolveTvmazeShow) — TVmaze is this app's real source for episode-level
// tracking, but a title that's genuinely missing from it (new, obscure, or
// region-locked shows) used to be a dead-end error instead of showing
// anything. This is TMDB-only and read-only: no watchlist/episodes/rating,
// since none of that has anywhere to attach without a TVmaze id. Reuses
// MovieDetailView (title/overview/cast/trailer/providers/recommendations —
// everything this needs) rather than building a near-identical component;
// the TMDBTvDetails -> TMDBMovieDetails-shaped adapter below is the only
// TV-vs-movie-specific glue.
export default function TmdbShowFallbackScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const goBack = useGoBack("/(tabs)");
  const { t, language } = useLanguage();
  const tmdbTvId = Number(id);

  const [tv, setTv] = useState<TMDBTvDetails | null>(null);
  const [tvNotFound, setTvNotFound] = useState(false);
  const [cast, setCast] = useState<TMDBCastMember[]>([]);
  const [trailerUrl, setTrailerUrl] = useState<string | null>(null);
  const [watchProviders, setWatchProviders] = useState<WatchProviders | null>(null);
  const [recommendations, setRecommendations] = useState<TMDBTvResult[]>([]);
  const [bookmark, setBookmark] = useState<TmdbOnlyShow | null>(null);
  const resolvedRecommendations = useRef<Map<number, number | null>>(new Map());

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setTv(null);
      setTvNotFound(false);
      setCast([]);

      getTvDetails(tmdbTvId)
        .then((d) => active && setTv(d))
        .catch(() => active && setTvNotFound(true));
      getTvCast(tmdbTvId)
        .then((c) => active && setCast(c))
        .catch(() => {});
      getTvTrailerUrl(tmdbTvId)
        .then((url) => active && setTrailerUrl(url))
        .catch(() => {});
      getTvWatchProviders(tmdbTvId, language)
        .then((p) => active && setWatchProviders(p))
        .catch(() => {});
      getTvRecommendations(tmdbTvId)
        .then((r) => active && setRecommendations(r))
        .catch(() => {});

      let currentBookmark: TmdbOnlyShow | null = null;
      fetchTmdbOnlyShowByTmdbId(tmdbTvId)
        .then((b) => {
          currentBookmark = b;
          if (active) setBookmark(b);
        })
        .catch(() => {});

      // If TVmaze actually *does* have this show (a transient TVmaze/TheTVDB
      // lookup hiccup the first time, or the id just wasn't cross-referenced
      // yet), hand off to the real, fully-tracked show page automatically
      // instead of stranding the user on this read-only fallback forever.
      // If it was bookmarked as a TMDB-only "want to watch", migrate that
      // bookmark into real tracking before redirecting.
      findTvmazeShowFromTmdbTv(tmdbTvId, "low")
        .then(async (resolved) => {
          if (!active || !resolved) return;
          if (currentBookmark) {
            await upsertUserShow({
              tvmaze_id: resolved.id,
              show_name: resolved.name,
              show_image: resolved.image?.medium ?? null,
              status: "want_to_watch",
            });
            await removeTmdbOnlyShow(tmdbTvId);
          }
          router.replace(`/show/${resolved.id}`);
        })
        .catch(() => {});

      return () => {
        active = false;
      };
    }, [tmdbTvId, language, router])
  );

  async function handleToggleBookmark() {
    if (bookmark) {
      setBookmark(null);
      await removeTmdbOnlyShow(tmdbTvId);
    } else {
      const created = await addTmdbOnlyShow(tmdbTvId, tv?.name ?? "", tv?.poster_path ?? null);
      setBookmark(created);
    }
  }

  async function openRecommendation(rec: TMDBTvResult) {
    const cached = resolvedRecommendations.current.get(rec.id);
    if (cached) {
      router.push(`/show/${cached}`);
      return;
    }
    if (cached === null) {
      router.push(`/show/tmdb/${rec.id}`);
      return;
    }
    const resolved = await findTvmazeShowFromTmdbTv(rec.id);
    resolvedRecommendations.current.set(rec.id, resolved?.id ?? null);
    router.push(resolved ? `/show/${resolved.id}` : `/show/tmdb/${rec.id}`);
  }

  if (!tv && !tvNotFound) return <MovieDetailLoading />;

  const recommendationItems: RecommendationItem[] = recommendations.map((r) => ({
    key: r.id,
    title: r.name,
    posterUrl: posterUrl(r.poster_path, "w200"),
    onPress: () => openRecommendation(r),
  }));

  return (
    <MovieDetailView
      title={tv?.name ?? ""}
      year={tv?.first_air_date ? new Date(tv.first_air_date).getFullYear() : null}
      tmdb={
        tv && {
          id: tv.id,
          title: tv.name,
          release_date: tv.first_air_date,
          poster_path: tv.poster_path,
          backdrop_path: tv.backdrop_path,
          overview: tv.overview,
          vote_average: tv.vote_average,
          runtime: null,
          genres: tv.genres,
          tagline: "",
        }
      }
      tmdbNotFound={tvNotFound}
      cast={cast}
      tmdbId={null}
      trailerUrl={trailerUrl}
      watchProviders={watchProviders}
      recommendations={recommendationItems}
      onBack={goBack}
      watchedPills={
        tv && (
          <Pill tone="accent" onPress={handleToggleBookmark}>
            {bookmark ? t.showDetail.inMyList : t.showDetail.addToMyList}
          </Pill>
        )
      }
    />
  );
}
