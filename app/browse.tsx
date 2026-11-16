import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { Sheet } from "../components/Sheet";
import { EmptyState } from "../components/EmptyState";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  fetchMovieListPage,
  fetchTvListPage,
  getMovieGenres,
  getTvGenres,
  getMovieWatchProviderList,
  getTvWatchProviderList,
  regionForLanguage,
  providerLogoUrl,
  findTvmazeShowFromTmdbTv,
  fetchResolvedTvmazeShows,
  posterUrl,
  TMDBGenre,
  TMDBSearchResult,
  TMDBTvResult,
  TMDBWatchProviderOption,
} from "../lib/tmdb";
import { TVMazeShow } from "../lib/tvmaze";
import { fetchUserShows, upsertUserShow, removeUserShow, setShowFavorite } from "../lib/userShows";
import { fetchUserMovieTmdbMap, addMovieToWatchlist, removeUserMovie, setMovieFavorite, UserMovie } from "../lib/userMovies";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { useGoBack } from "../lib/useGoBack";
import { mapWithConcurrency } from "../lib/concurrency";
import { alert } from "../lib/alert";

type BrowseKind = "movie" | "tv";
type BrowseItem = TMDBSearchResult | TMDBTvResult;

// One entry per Explore category row (see app/(tabs)/explore.tsx's own
// showCategories/movieCategories) — the base TMDB path each "View all" tap
// should keep paging through. "forYou" categories aren't listed here (they
// depend on the viewer's own top genres, computed in lib/forYou.ts, not a
// fixed path) — tapping into one just falls back to Popular instead of
// needing its own plumbing here.
type CategoryTitleKey =
  | "categoryPopularMovies"
  | "categoryTopRatedMovies"
  | "categoryOnTheAirTv"
  | "categoryNowPlayingMovies"
  | "categoryUpcomingMovies";
type BrowseSort = "popular" | "top" | "new";

function isoDaysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// `sort` is the order the category's own list comes in; `constraints` is
// what the category means beyond its order (a release window), carried into
// /discover once a genre/platform/sort is picked — otherwise "Coming soon"
// filtered to Comedy used to turn into plain popular comedies under the
// same title.
interface CategoryConfig {
  kind: BrowseKind;
  path: string;
  titleKey: CategoryTitleKey;
  sort: BrowseSort;
  constraints?: () => Record<string, string>;
  // Only future releases — "new" then means soonest first.
  futureOnly?: boolean;
}
const CATEGORY_PATHS: Record<string, CategoryConfig> = {
  popularTv: { kind: "tv", path: "/tv/popular", titleKey: "categoryPopularMovies", sort: "popular" },
  topRatedTv: { kind: "tv", path: "/tv/top_rated", titleKey: "categoryTopRatedMovies", sort: "top" },
  onTheAirTv: {
    kind: "tv",
    path: "/tv/on_the_air",
    titleKey: "categoryOnTheAirTv",
    sort: "popular",
    constraints: () => ({ "air_date.gte": isoDaysFromToday(0), "air_date.lte": isoDaysFromToday(7) }),
  },
  popularMovies: { kind: "movie", path: "/movie/popular", titleKey: "categoryPopularMovies", sort: "popular" },
  topRatedMovies: { kind: "movie", path: "/movie/top_rated", titleKey: "categoryTopRatedMovies", sort: "top" },
  nowPlayingMovies: {
    kind: "movie",
    path: "/movie/now_playing",
    titleKey: "categoryNowPlayingMovies",
    sort: "popular",
    constraints: () => ({ "primary_release_date.gte": isoDaysFromToday(-45), "primary_release_date.lte": isoDaysFromToday(0) }),
  },
  upcomingMovies: {
    kind: "movie",
    path: "/movie/upcoming",
    titleKey: "categoryUpcomingMovies",
    sort: "popular",
    constraints: () => ({ "primary_release_date.gte": isoDaysFromToday(1) }),
    futureOnly: true,
  },
};

// /discover ordering for each sort. "top" needs a vote floor or it's all
// obscure titles rated 10 by three people; "new" stops at today so it's
// what's out, not what's announced — unless the category itself is about
// future releases.
function sortParams(kind: BrowseKind, sort: BrowseSort, futureOnly: boolean): Record<string, string> {
  if (sort === "top") return { sort_by: "vote_average.desc", "vote_count.gte": kind === "movie" ? "300" : "150" };
  if (sort === "new") {
    const dateField = kind === "movie" ? "primary_release_date" : "first_air_date";
    return futureOnly
      ? { sort_by: `${dateField}.asc` }
      : { sort_by: `${dateField}.desc`, [`${dateField}.lte`]: isoDaysFromToday(0), "vote_count.gte": "5" };
  }
  return { sort_by: "popularity.desc" };
}

function isTv(kind: BrowseKind, item: BrowseItem): item is TMDBTvResult {
  return kind === "tv";
}

// Same card size/pitch as Profile's own "view all" grid (app/users/[id]/
// list.tsx's CARD_WIDTH/CARD_MARGIN_RIGHT/GRID_PADDING) and Explore's search
// results (its wrapGridItem, which mirrors these same constants) — one
// fixed size that just naturally fits more columns on a wider screen via
// numColumns below, rather than a separate phone/desktop size to keep in
// sync by hand. This screen used to stretch each card to 1/3 of the screen
// width, which looked fine on a phone but turned into oversized cards on a
// wide/desktop viewport; 110 fits 3 per row on a typical ~390px phone (like
// Profile's grid) and scales up from there.
const CARD_WIDTH = 110;
const GRID_GAP = 12;
const GRID_PADDING = 12;

// Platform logo strip: 44px logo inside 2px padding + a 2px selection ring
// on each side, 10px apart — fixed so getItemLayout can scroll straight to
// the selected one.
const LOGO_SIZE = 44;
const LOGO_PITCH = LOGO_SIZE + 2 * 2 + 2 * 2 + 10;
const LOGO_ROW_PADDING = 16;

// Module-level, not component state — this app's web build remounts a
// screen from scratch on back-navigation rather than keeping it alive off-
// stack the way native screens do, so anything stored in a ref/useState
// here is gone by the time the user taps back. A plain Map outside the
// component survives that remount, so opening a card, then backing out,
// restores exactly the same items (no re-fetch flash) and scroll position
// instead of dropping back to the top of a freshly refetched page 1. Keyed
// by category/genre — a genuinely different browse is a fresh start, only
// "the exact same list I was just looking at" gets restored.
interface BrowseCacheEntry {
  items: BrowseItem[];
  page: number;
  hasMore: boolean;
  scrollOffset: number;
}
const browseStateCache = new Map<string, BrowseCacheEntry>();

function browseCacheKey(
  categoryKey: string | undefined,
  kind: BrowseKind,
  genreId: number | null,
  providerId: number | null,
  sort: BrowseSort
): string {
  return `${categoryKey ?? kind}:${genreId ?? "none"}:${providerId ?? "none"}:${sort}`;
}

// Scrollable "View all" grid — either an Explore category (?category=...,
// pages through the same TMDB list a home-screen row only shows the first
// 20 of) or a genre browse (?kind=movie|tv, optionally &genreId=... — the
// genre chips below switch this in place rather than needing a second
// screen). Infinite-scroll paginated via fetchMovieListPage/fetchTvListPage
// (lib/tmdb.ts) — TMDB caps out at 500 pages, effectively unbounded here.
export default function BrowseScreen() {
  const params = useLocalSearchParams<{ category?: string; kind?: string; genreId?: string; providerId?: string; title?: string }>();
  const router = useRouter();
  const goBack = useGoBack("/(tabs)/explore");
  const colors = useColors();
  const { t, language } = useLanguage();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const styles = useMemo(
    () => createStyles(colors, CARD_WIDTH, GRID_GAP, GRID_PADDING),
    [colors],
  );
  const numColumns = Math.max(1, Math.floor((windowWidth - GRID_PADDING * 2 + GRID_GAP) / (CARD_WIDTH + GRID_GAP)));

  const categoryConfig = params.category ? CATEGORY_PATHS[params.category] : undefined;
  const [kind, setKind] = useState<BrowseKind>(categoryConfig?.kind ?? (params.kind === "movie" ? "movie" : "tv"));
  const [genreId, setGenreId] = useState<number | null>(params.genreId ? Number(params.genreId) : null);
  const [providerId, setProviderId] = useState<number | null>(params.providerId ? Number(params.providerId) : null);
  const [genres, setGenres] = useState<TMDBGenre[]>([]);
  const [providers, setProviders] = useState<TMDBWatchProviderOption[]>([]);
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [resolving, setResolving] = useState<number | null>(null);
  const defaultSort: BrowseSort = categoryConfig?.sort ?? "popular";
  const [sort, setSort] = useState<BrowseSort>(defaultSort);
  const [picker, setPicker] = useState<"genre" | "sort" | null>(null);
  // Hides what's already in my list (added or watched) — for finding
  // something new rather than scrolling past what I already know.
  const [hideMine, setHideMine] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const providerRowRef = useRef<FlatList<TMDBWatchProviderOption | null>>(null);
  const listRef = useRef<FlatList<BrowseItem>>(null);
  const cacheKey = browseCacheKey(params.category, kind, genreId, providerId, sort);

  // The viewer's own tracked/favorited shows and movies — same idea as
  // Explore's own cards (app/(tabs)/explore.tsx): favoriting/adding here
  // always acts on your own account, regardless of which category/genre
  // you're browsing. Fetched once on mount, not per genre/page change.
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());
  const [movieTmdbMap, setMovieTmdbMap] = useState<Map<number, UserMovie>>(new Map());
  // A TV item here only ever starts out as a TMDB id — every action on it
  // (open, favorite, add) resolves to the matching TVmaze show first (see
  // lib/tmdb.ts's findTvmazeShowFromTmdbTv, and explore.tsx's identical
  // resolveTvmazeShow this mirrors), cached here so paging back to an
  // already-resolved card doesn't re-resolve it.
  const [resolvedTvShows, setResolvedTvShows] = useState<Map<number, TVMazeShow>>(new Map());
  // Which card's favorite/add button is mid-resolve — distinct from
  // `resolving` above, which is specifically for tapping the card itself to
  // open it; a button tap shows its own small spinner instead of the
  // whole-card overlay `resolving` drives.
  const [actionPending, setActionPending] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    fetchUserShows().then((r) => {
      if (!active) return;
      setAddedIds(new Set(r.map((s) => s.tvmaze_id)));
      setFavoriteIds(new Set(r.filter((s) => s.is_favorite).map((s) => s.tvmaze_id)));
    });
    fetchUserMovieTmdbMap().then((m) => active && setMovieTmdbMap(m));
    return () => {
      active = false;
    };
  }, []);

  const selectedGenre = genres.find((g) => g.id === genreId);
  const selectedProvider = providers.find((p) => p.provider_id === providerId);
  // Follows the platform picked here, not just the one Explore opened this
  // screen with (params.title), so switching platforms renames the page.
  // A category named after its order ("Top rated") stops being that once
  // another sort is picked; one named after a release window keeps its name,
  // since the window still applies (see CategoryConfig).
  const categoryTitleHolds = !!categoryConfig && (!!categoryConfig.constraints || sort === categoryConfig.sort);
  const title = selectedProvider?.provider_name
    ?? (providerId !== null ? (params.title as string) : null)
    ?? (categoryConfig && categoryTitleHolds ? t.explore[categoryConfig.titleKey] : null)
    ?? (categoryConfig ? (kind === "tv" ? t.tabs.shows : t.tabs.movies) : t.explore.viewAll);

  const sortLabels: Record<BrowseSort, string> = {
    popular: t.explore.sortPopularity,
    top: t.explore.sortRating,
    new: t.explore.sortNewest,
  };

  // Unreleased films have no votes yet, so "by rating" on Coming soon would
  // always come back empty.
  const sortOptions: BrowseSort[] = categoryConfig?.futureOnly ? ["popular", "new"] : ["popular", "top", "new"];

  // Added (or favorited) from this page during this visit — kept on screen
  // even with "not in my list" on, so tapping + doesn't make the card vanish
  // from under the finger with no feedback.
  const [keptIds, setKeptIds] = useState<Set<number>>(new Set());
  function keep(id: number) {
    setKeptIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }

  function isMine(item: BrowseItem): boolean {
    if (keptIds.has(item.id)) return false;
    if (kind === "movie") return movieTmdbMap.has(item.id);
    const resolvedId = resolvedTvShows.get(item.id)?.id;
    return resolvedId !== undefined && addedIds.has(resolvedId);
  }
  const visibleItems = hideMine ? items.filter((i) => !isMine(i)) : items;

  // Genre ids aren't shared between TMDB's movie and TV lists, so a genre
  // picked on one side can't carry over; the platform id can.
  function switchKind(next: BrowseKind) {
    if (next === kind) return;
    setGenreId(null);
    setKind(next);
  }

  // Genre chips — switching one resets to a fresh /discover query for that
  // genre (or back to the category's own list when "All genres" is picked
  // again), same kind (movie/tv) throughout.
  useEffect(() => {
    (kind === "movie" ? getMovieGenres(language) : getTvGenres(language)).then(setGenres).catch(() => {});
  }, [kind, language]);

  // Platform chips — same idea as the genre row above, via TMDB's own
  // with_watch_providers discover filter. Switching platforms resets to a
  // fresh /discover query the same way a genre switch does, and the two can
  // be combined (e.g. "Comedy" + "Netflix" at once) since TMDB's /discover
  // endpoint accepts both filters together.
  useEffect(() => {
    (kind === "movie" ? getMovieWatchProviderList(language) : getTvWatchProviderList(language)).then(setProviders).catch(() => {});
  }, [kind, language]);

  const fetchPage = useCallback(
    async (pageNum: number): Promise<BrowseItem[]> => {
      const constraints = categoryConfig?.constraints?.() ?? {};
      const discoverParams: Record<string, string> = { ...constraints, ...sortParams(kind, sort, !!categoryConfig?.futureOnly) };
      if (genreId) discoverParams.with_genres = String(genreId);
      if (providerId) {
        discoverParams.with_watch_providers = String(providerId);
        discoverParams.watch_region = regionForLanguage(language);
      }
      // The category's own list is used only while nothing about it has
      // been changed; anything else goes through /discover.
      const useDiscover = genreId !== null || providerId !== null || sort !== defaultSort;
      if (kind === "movie") {
        if (useDiscover) return fetchMovieListPage("/discover/movie", pageNum, discoverParams);
        return fetchMovieListPage(categoryConfig?.path ?? "/movie/popular", pageNum);
      }
      if (useDiscover) return fetchTvListPage("/discover/tv", pageNum, discoverParams);
      return fetchTvListPage(categoryConfig?.path ?? "/tv/popular", pageNum);
    },
    [kind, genreId, providerId, sort, defaultSort, categoryConfig, language],
  );

  // Restores from browseStateCache when this exact browse (same category/
  // genre) was already loaded before — e.g. the user tapped into a card and
  // just came back — instead of always refetching from page 1. Only a
  // genuinely new key (a different category, or a freshly picked genre)
  // starts over. See browseStateCache's own comment for why this can't just
  // be component state.
  useEffect(() => {
    const cached = browseStateCache.get(cacheKey);
    if (cached) {
      setItems(cached.items);
      setPage(cached.page);
      setHasMore(cached.hasMore);
      setLoading(false);
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset: cached.scrollOffset, animated: false });
      });
      return;
    }

    let active = true;
    setLoading(true);
    setLoadError(false);
    setItems([]);
    setPage(1);
    setHasMore(true);
    fetchPage(1)
      .then((results) => {
        if (!active) return;
        setItems(results);
        setHasMore(results.length > 0);
        browseStateCache.set(cacheKey, { items: results, page: 1, hasMore: results.length > 0, scrollOffset: 0 });
      })
      .catch(() => {
        if (!active) return;
        setHasMore(false);
        setLoadError(true);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, retryNonce]);

  // The native touch/click on a card (see each card's onPressIn below)
  // fires one spurious scroll-to-0 event on web before onPress even runs —
  // found by tracing it directly, not a guess — which without this guard
  // overwrote the real, meaningfully-scrolled offset with 0 a moment before
  // it got cached, defeating the whole point of restoring it on the way
  // back. Set on onPressIn specifically (not inside openItem) because by
  // the time openItem runs, the spurious event has already fired; reset
  // back to false only for the one path that turns out not to navigate
  // (see openItem's "no match" branch).
  const navigatingAwayRef = useRef(false);
  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (navigatingAwayRef.current) return;
    const entry = browseStateCache.get(cacheKey);
    if (entry) entry.scrollOffset = e.nativeEvent.contentOffset.y;
  }

  function loadMore() {
    if (loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    fetchPage(nextPage)
      .then((results) => {
        setItems((prev) => {
          const next = [...prev, ...results];
          const entry = browseStateCache.get(cacheKey);
          browseStateCache.set(cacheKey, {
            items: next,
            page: nextPage,
            hasMore: results.length > 0,
            scrollOffset: entry?.scrollOffset ?? 0,
          });
          return next;
        });
        setHasMore(results.length > 0);
        setPage(nextPage);
      })
      .catch(() => setHasMore(false))
      .finally(() => setLoadingMore(false));
  }

  // With "hide mine" on, a page can come back mostly or entirely filtered
  // out, which leaves nothing to scroll and so never triggers onEndReached —
  // keep fetching until there's at least a few rows' worth to show.
  useEffect(() => {
    if (!hideMine || loading || loadingMore || !hasMore) return;
    if (visibleItems.length < numColumns * 4) loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideMine, loading, loadingMore, hasMore, visibleItems.length, numColumns]);

  // Opening a TV card used to start its TMDB → TVmaze lookup only on tap,
  // which is what made a platform/category page feel slow to open a show
  // from. Two head starts now, same idea as Explore's own prefetch (app/
  // (tabs)/explore.tsx): every loaded page is resolved in the background —
  // one batched read of the shared cache first, then a low-priority lookup
  // for the rest — and a card's lookup starts the moment it's touched
  // (onPressIn), so onPress usually finds it already done.
  const attemptedResolveIds = useRef<Set<number>>(new Set());
  const inflightResolves = useRef<Map<number, { priority: "high" | "low"; promise: Promise<TVMazeShow | null> }>>(new Map());
  useEffect(() => {
    if (kind !== "tv") return;
    const toResolve = (items as TMDBTvResult[]).filter((i) => !attemptedResolveIds.current.has(i.id));
    if (toResolve.length === 0) return;
    for (const i of toResolve) attemptedResolveIds.current.add(i.id);
    let cancelled = false;
    (async () => {
      const cached = await fetchResolvedTvmazeShows(toResolve.map((i) => i.id)).catch(() => new Map<number, TVMazeShow>());
      if (cancelled) return;
      if (cached.size > 0) {
        setResolvedTvShows((prev) => {
          const next = new Map(prev);
          for (const [id, show] of cached) next.set(id, show);
          return next;
        });
      }
      const missing = toResolve.filter((i) => !cached.has(i.id));
      await mapWithConcurrency(
        missing,
        3,
        (i) => (cancelled ? Promise.resolve(null) : startResolve(i.id, "low").catch(() => null)),
        (result, i) => {
          if (cancelled || !result) return;
          setResolvedTvShows((prev) => (prev.has(i.id) ? prev : new Map(prev).set(i.id, result)));
        },
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, kind]);

  function startResolve(tmdbId: number, priority: "high" | "low"): Promise<TVMazeShow | null> {
    // A background (low) lookup still queued behind others doesn't count
    // once the card is actually touched — that one jumps the queue.
    const existing = inflightResolves.current.get(tmdbId);
    if (existing && (existing.priority === "high" || priority === "low")) return existing.promise;
    const promise = findTvmazeShowFromTmdbTv(tmdbId, priority).finally(() => {
      if (inflightResolves.current.get(tmdbId)?.promise === promise) inflightResolves.current.delete(tmdbId);
    });
    inflightResolves.current.set(tmdbId, { priority, promise });
    return promise;
  }

  async function resolveTvmazeShow(item: TMDBTvResult): Promise<TVMazeShow | null> {
    const cached = resolvedTvShows.get(item.id);
    if (cached) return cached;
    const resolved = await startResolve(item.id, "high");
    if (!resolved) {
      alert(t.explore.noMatchTitle, t.explore.noMatchDesc);
      return null;
    }
    setResolvedTvShows((prev) => new Map(prev).set(item.id, resolved));
    return resolved;
  }

  async function openItem(item: BrowseItem) {
    // navigatingAwayRef is already true from the card's own onPressIn — set
    // early enough to beat the spurious scroll-to-0 event (see onScroll's
    // comment). Only reset it back here, for the one path that turns out
    // not to navigate after all.
    if (kind === "movie") {
      router.push(`/movie/tmdb/${item.id}`);
      return;
    }
    setResolving(item.id);
    try {
      const resolved = await resolveTvmazeShow(item as TMDBTvResult);
      if (resolved) {
        router.push(`/show/${resolved.id}`);
      } else {
        navigatingAwayRef.current = false;
      }
    } finally {
      setResolving(null);
    }
  }

  // TVmaze-native add/favorite — used directly once a TV item has a real
  // tvmaze id (either already resolved, or right after resolveTvmazeShow
  // below resolves one). Mirrors explore.tsx's own quickAdd/toggleFavorite
  // exactly, same underlying user_shows upsert.
  async function quickAdd(show: TVMazeShow) {
    if (addedIds.has(show.id)) {
      await removeUserShow(show.id);
      setAddedIds((prev) => {
        const next = new Set(prev);
        next.delete(show.id);
        return next;
      });
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        next.delete(show.id);
        return next;
      });
    } else {
      await upsertUserShow({
        tvmaze_id: show.id,
        show_name: show.name,
        show_image: show.image?.medium ?? null,
        status: "want_to_watch",
      });
      setAddedIds((prev) => new Set(prev).add(show.id));
    }
  }

  async function toggleFavorite(show: TVMazeShow) {
    const isFav = favoriteIds.has(show.id);
    if (!addedIds.has(show.id)) {
      await upsertUserShow({
        tvmaze_id: show.id,
        show_name: show.name,
        show_image: show.image?.medium ?? null,
        status: "want_to_watch",
      });
      setAddedIds((prev) => new Set(prev).add(show.id));
    }
    await setShowFavorite(show.id, !isFav);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (isFav) next.delete(show.id);
      else next.add(show.id);
      return next;
    });
  }

  async function quickAddTmdbShow(item: TMDBTvResult) {
    keep(item.id);
    setActionPending(item.id);
    try {
      const resolved = await resolveTvmazeShow(item);
      if (resolved) await quickAdd(resolved);
    } finally {
      setActionPending((p) => (p === item.id ? null : p));
    }
  }

  async function toggleFavoriteTmdbShow(item: TMDBTvResult) {
    keep(item.id);
    setActionPending(item.id);
    try {
      const resolved = await resolveTvmazeShow(item);
      if (resolved) await toggleFavorite(resolved);
    } finally {
      setActionPending((p) => (p === item.id ? null : p));
    }
  }

  // Movies already carry their own TMDB id as the id user_movies tracks by
  // — no resolution step needed, same reasoning as explore.tsx's own
  // quickAddMovie/toggleFavoriteMovie, which these mirror.
  async function quickAddMovie(item: TMDBSearchResult) {
    keep(item.id);
    const existing = movieTmdbMap.get(item.id);
    if (existing?.status === "want_to_watch") {
      await removeUserMovie(existing.id);
      setMovieTmdbMap((prev) => {
        const next = new Map(prev);
        next.delete(item.id);
        return next;
      });
      return;
    }
    if (existing?.status === "watched") return;
    const year = item.release_date ? Number(item.release_date.slice(0, 4)) : null;
    const row = await addMovieToWatchlist(item.id, item.title, year, item.poster_path);
    setMovieTmdbMap((prev) => new Map(prev).set(item.id, row));
  }

  async function toggleFavoriteMovie(item: TMDBSearchResult) {
    keep(item.id);
    const year = item.release_date ? Number(item.release_date.slice(0, 4)) : null;
    const existing = movieTmdbMap.get(item.id);
    const row = existing ?? (await addMovieToWatchlist(item.id, item.title, year, item.poster_path));
    const updated = await setMovieFavorite(row.id, !row.is_favorite);
    setMovieTmdbMap((prev) => new Map(prev).set(item.id, updated));
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.headerTitleRow}>
          {selectedProvider?.logo_path && (
            <Image source={{ uri: providerLogoUrl(selectedProvider.logo_path)! }} style={styles.headerLogo} contentFit="cover" />
          )}
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <View style={{ width: 24 }} />
      </View>

      {/* Platforms as a strip of logos — recognisable at a glance, 7-8 fit
          across a phone, and the selected one is scrolled into view (it
          used to sit off-screen at the end of a row of named chips). null
          is "all platforms". */}
      <FlatList
        ref={providerRowRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.logoRowOuter}
        contentContainerStyle={styles.logoRow}
        data={[null, ...providers]}
        keyExtractor={(p) => String(p?.provider_id ?? "all")}
        getItemLayout={(_, index) => ({ length: LOGO_PITCH, offset: LOGO_ROW_PADDING + LOGO_PITCH * index, index })}
        onContentSizeChange={() => {
          const index = providerId === null ? 0 : providers.findIndex((p) => p.provider_id === providerId) + 1;
          if (index > 0) providerRowRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
        }}
        renderItem={({ item: p }) => {
          const selected = (p?.provider_id ?? null) === providerId;
          return (
            <Pressable
              style={[styles.logoItem, selected && styles.logoItemActive]}
              onPress={() => setProviderId(p?.provider_id ?? null)}
              accessibilityRole="button"
              accessibilityLabel={p?.provider_name ?? t.explore.allPlatforms}
              accessibilityState={{ selected }}
            >
              {p?.logo_path ? (
                <Image source={{ uri: providerLogoUrl(p.logo_path)! }} style={styles.logoImage} contentFit="cover" />
              ) : (
                <View style={[styles.logoImage, styles.logoAll]}>
                  <Ionicons name="apps-outline" size={20} color={selected ? colors.accent : colors.textMuted} />
                </View>
              )}
            </Pressable>
          );
        }}
      />

      {/* Under the logos, since the platform is what this page is usually
          opened for. Scrolls sideways rather than squeezing: on a phone the
          four controls don't fit in one row, and shrinking them truncated
          the labels. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBarOuter}
        contentContainerStyle={styles.filterBar}
      >
        {!categoryConfig && (
          <View style={styles.segment}>
            {(["tv", "movie"] as const).map((k) => (
              <Pressable
                key={k}
                style={[styles.segmentItem, kind === k && styles.segmentItemActive]}
                onPress={() => switchKind(k)}
                accessibilityRole="button"
                accessibilityState={{ selected: kind === k }}
              >
                <Text style={[styles.segmentText, kind === k && styles.segmentTextActive]}>
                  {k === "tv" ? t.tabs.shows : t.tabs.movies}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        <Pressable
          style={[styles.filterBtn, genreId !== null && styles.filterBtnActive]}
          onPress={() => setPicker("genre")}
          accessibilityRole="button"
        >
          <Text style={[styles.filterBtnText, genreId !== null && styles.filterBtnTextActive]} numberOfLines={1}>
            {selectedGenre?.name ?? t.explore.filterGenre}
          </Text>
          <Ionicons name="chevron-down" size={14} color={genreId !== null ? colors.onAccent : colors.textMuted} />
        </Pressable>
        {/* Icon only — the current sort is shown ticked in the sheet it
            opens, and the button turns accent once it's not the default. */}
        <Pressable
          style={[styles.filterBtn, styles.sortBtn, sort !== defaultSort && styles.filterBtnActive]}
          onPress={() => setPicker("sort")}
          accessibilityRole="button"
          accessibilityLabel={`${t.explore.sortBy} : ${sortLabels[sort]}`}
        >
          <Ionicons name="swap-vertical" size={16} color={sort !== defaultSort ? colors.onAccent : colors.textMuted} />
        </Pressable>
        <Pressable
          style={[styles.filterBtn, hideMine && styles.filterBtnActive]}
          onPress={() => setHideMine((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: hideMine }}
        >
          {hideMine && <Ionicons name="checkmark" size={14} color={colors.onAccent} />}
          <Text style={[styles.filterBtnText, hideMine && styles.filterBtnTextActive]} numberOfLines={1}>
            {t.explore.notInMyList}
          </Text>
        </Pressable>
      </ScrollView>

      <Sheet visible={picker !== null} onClose={() => setPicker(null)}>
        <Text style={styles.pickerTitle}>{picker === "sort" ? t.explore.sortBy : t.explore.filterGenre}</Text>
        <ScrollView style={{ maxHeight: windowHeight * 0.6 }} contentContainerStyle={styles.pickerList}>
          {picker === "sort"
            ? sortOptions.map((k) => (
                <Pressable
                  key={k}
                  style={[styles.chip, sort === k && styles.chipActive]}
                  onPress={() => {
                    setSort(k);
                    setPicker(null);
                  }}
                >
                  <Text style={[styles.chipText, sort === k && styles.chipTextActive]}>{sortLabels[k]}</Text>
                </Pressable>
              ))
            : [{ id: null as number | null, name: t.explore.allGenres }, ...genres.map((g) => ({ id: g.id as number | null, name: g.name }))].map((g) => (
                <Pressable
                  key={String(g.id)}
                  style={[styles.chip, genreId === g.id && styles.chipActive]}
                  onPress={() => {
                    setGenreId(g.id);
                    setPicker(null);
                  }}
                >
                  <Text style={[styles.chipText, genreId === g.id && styles.chipTextActive]}>{g.name}</Text>
                </Pressable>
              ))}
        </ScrollView>
      </Sheet>

      {loading ? (
        // Grey cards in the grid's own shape rather than a lone spinner, so
        // the page reads as "filling in" instead of "blank".
        <View style={[styles.grid, styles.skeletonGrid]}>
          {Array.from({ length: numColumns * 4 }, (_, i) => (
            <View key={i} style={styles.card}>
              <View style={styles.poster} />
              <View style={styles.skeletonLine} />
              <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          // numColumns can't change on an already-mounted FlatList (RN warns
          // and ignores it) — keying by it forces a remount on the rare
          // resize that crosses a column-count boundary instead of silently
          // keeping a stale column count.
          key={`grid-${numColumns}`}
          ref={listRef}
          data={visibleItems}
          keyExtractor={(item, index) => `${item.id}-${index}`}
          numColumns={numColumns}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          onScroll={onScroll}
          scrollEventThrottle={16}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} /> : null}
          ListEmptyComponent={
            loadingMore ? null : loadError ? (
              <EmptyState
                icon="cloud-offline-outline"
                title={t.explore.loadErrorTitle}
                subtitle={t.explore.loadErrorDesc}
                actionLabel={t.explore.retry}
                onAction={() => {
                  browseStateCache.delete(cacheKey);
                  setRetryNonce((n) => n + 1);
                }}
              />
            ) : (
              <EmptyState
                icon="search-outline"
                title={t.explore.noResultsTitle}
                subtitle={hideMine && items.length > 0 ? t.explore.noResultsAllMine : t.explore.noResultsDesc}
                {...(hideMine && items.length > 0
                  ? { actionLabel: t.explore.showMine, onAction: () => setHideMine(false) }
                  : genreId !== null
                    ? { actionLabel: t.explore.clearGenre, onAction: () => setGenreId(null) }
                    : providerId !== null
                      ? { actionLabel: t.explore.allPlatforms, onAction: () => setProviderId(null) }
                      : {})}
              />
            )
          }
          renderItem={({ item }) => {
            const name = isTv(kind, item) ? item.name : (item as TMDBSearchResult).title;
            const date = isTv(kind, item) ? item.first_air_date : (item as TMDBSearchResult).release_date;
            const poster = posterUrl(item.poster_path, "w200");
            // A TV item only knows whether it's already added/favorited once
            // resolveTvmazeShow has resolved it at least once (see its own
            // comment) — until then these just read as "not yet", same as
            // explore.tsx's identical isAdded/isFavorite computation for its
            // own TMDB-sourced show cards.
            const resolvedId = isTv(kind, item) ? resolvedTvShows.get(item.id)?.id : undefined;
            const isFav = kind === "movie" ? !!movieTmdbMap.get(item.id)?.is_favorite : resolvedId !== undefined && favoriteIds.has(resolvedId);
            const isAddedNow = kind === "movie" ? movieTmdbMap.has(item.id) : resolvedId !== undefined && addedIds.has(resolvedId);
            return (
              <Pressable
                style={styles.card}
                onPressIn={() => {
                  // Earlier than onPress — found by tracing it directly, the
                  // spurious scroll-to-0 event (see onScroll's own comment)
                  // fires on the initial touch/click itself, before onPress
                  // ever runs, so gating there was already too late.
                  navigatingAwayRef.current = true;
                  if (isTv(kind, item) && !resolvedTvShows.has(item.id)) startResolve(item.id, "high").catch(() => {});
                }}
                onPress={() => openItem(item)}
                disabled={resolving === item.id}
              >
                <View style={styles.posterWrap}>
                  {poster ? (
                    <Image source={{ uri: poster }} style={styles.poster} contentFit="cover" />
                  ) : (
                    <View style={[styles.poster, styles.posterPlaceholder]}>
                      <Text style={styles.posterPlaceholderText}>{name?.[0]}</Text>
                    </View>
                  )}
                  {resolving === item.id && (
                    <View style={styles.resolvingOverlay}>
                      <ActivityIndicator color="#fff" />
                    </View>
                  )}
                  {/* Same heart/add icon pair Explore's own cards show
                      (ExploreCard/ExploreMovieCard) — stopPropagation on
                      both onPressIn and onPress: onPressIn because the
                      outer card's own onPressIn (navigatingAwayRef above)
                      would otherwise fire too and permanently wedge the
                      scroll-restoration guard on, onPress because without
                      it tapping either icon would also openItem. */}
                  <View style={styles.cardActions}>
                    <Pressable
                      style={styles.iconBtn}
                      onPressIn={(e) => e.stopPropagation()}
                      onPress={(e) => {
                        e.stopPropagation();
                        if (kind === "movie") toggleFavoriteMovie(item as TMDBSearchResult);
                        else toggleFavoriteTmdbShow(item as TMDBTvResult);
                      }}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel="Favorite"
                    >
                      <Ionicons name={isFav ? "heart" : "heart-outline"} size={15} color={isFav ? colors.red : "#fff"} />
                    </Pressable>
                    <Pressable
                      style={[styles.iconBtn, isAddedNow && styles.iconBtnActive]}
                      onPressIn={(e) => e.stopPropagation()}
                      onPress={(e) => {
                        e.stopPropagation();
                        if (kind === "movie") quickAddMovie(item as TMDBSearchResult);
                        else quickAddTmdbShow(item as TMDBTvResult);
                      }}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel="Add"
                    >
                      {actionPending === item.id ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Ionicons name={isAddedNow ? "checkmark" : "add"} size={16} color={isAddedNow ? colors.onAccent : "#fff"} />
                      )}
                    </Pressable>
                  </View>
                </View>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {name}
                </Text>
                <Text style={styles.cardMeta} numberOfLines={1}>
                  {date ? date.slice(0, 4) : ""}
                  {item.vote_average ? ` · ⭐ ${item.vote_average.toFixed(1)}` : ""}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

function createStyles(colors: Colors, CARD_WIDTH: number, GRID_GAP: number, GRID_PADDING: number) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 12,
    },
    headerTitleRow: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 8 },
    headerLogo: { width: 24, height: 24, borderRadius: 6 },
    headerTitle: { flexShrink: 1, fontSize: type.title, fontWeight: "800", color: colors.text },
    filterBarOuter: { flexGrow: 0, flexShrink: 0 },
    filterBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
    sortBtn: { paddingHorizontal: 9 },
    segment: {
      flexDirection: "row",
      padding: 3,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    segmentItem: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill },
    segmentItemActive: { backgroundColor: colors.accent },
    segmentText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
    segmentTextActive: { color: colors.onAccent },
    filterBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    filterBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    filterBtnText: { color: colors.text, fontSize: 12, fontWeight: "700" },
    filterBtnTextActive: { color: colors.onAccent },
    logoRowOuter: { flexGrow: 0, flexShrink: 0 },
    logoRow: { paddingHorizontal: LOGO_ROW_PADDING, gap: 10, paddingBottom: 12 },
    logoItem: { padding: 2, borderRadius: 14, borderWidth: 2, borderColor: "transparent" },
    logoItemActive: { borderColor: colors.accent },
    logoImage: { width: LOGO_SIZE, height: LOGO_SIZE, borderRadius: 11 },
    logoAll: { alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    skeletonGrid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP, justifyContent: "center" },
    skeletonLine: { height: 10, borderRadius: 5, marginTop: 8, backgroundColor: colors.backgroundAlt },
    skeletonLineShort: { width: "50%" },
    pickerTitle: { fontSize: type.subtitle, fontWeight: "800", color: colors.text, marginBottom: 12 },
    pickerList: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 8 },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
    chipTextActive: { color: colors.onAccent },
    grid: { paddingHorizontal: GRID_PADDING, paddingBottom: 32 },
    row: { gap: GRID_GAP, justifyContent: "center" },
    card: { width: CARD_WIDTH, marginBottom: 16 },
    // Wraps just the poster (not the title/meta text below it) so the
    // resolving overlay and the favorite/add buttons can position
    // themselves absolutely against the poster alone.
    posterWrap: { position: "relative" },
    poster: { width: CARD_WIDTH, aspectRatio: 2 / 3, borderRadius: radius.sm, backgroundColor: colors.backgroundAlt },
    posterPlaceholder: { alignItems: "center", justifyContent: "center" },
    posterPlaceholderText: { color: colors.textFaint, fontSize: type.display, fontWeight: "800" },
    resolvingOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: radius.sm,
      backgroundColor: "rgba(0,0,0,0.4)",
      alignItems: "center",
      justifyContent: "center",
    },
    // Matches Explore's own cardActions/iconBtn (app/(tabs)/explore.tsx's
    // ExploreCard/ExploreMovieCard) so a card looks the same here as it
    // does in search.
    cardActions: { position: "absolute", top: 8, right: 8, gap: 6 },
    iconBtn: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: "rgba(0,0,0,0.45)",
      alignItems: "center",
      justifyContent: "center",
    },
    iconBtnActive: { backgroundColor: colors.accent },
    cardTitle: { color: colors.text, fontSize: 12, fontWeight: "700", marginTop: 6 },
    cardMeta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  });
}
