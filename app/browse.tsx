import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  NativeSyntheticEvent,
  NativeScrollEvent,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  fetchMovieListPage,
  fetchTvListPage,
  getMovieGenres,
  getTvGenres,
  findTvmazeShowFromTmdbTv,
  posterUrl,
  TMDBGenre,
  TMDBSearchResult,
  TMDBTvResult,
} from "../lib/tmdb";
import { TVMazeShow } from "../lib/tvmaze";
import { fetchUserShows, upsertUserShow, removeUserShow, setShowFavorite } from "../lib/userShows";
import { fetchUserMovieTmdbMap, addMovieToWatchlist, removeUserMovie, setMovieFavorite, UserMovie } from "../lib/userMovies";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { useGoBack } from "../lib/useGoBack";
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
const CATEGORY_PATHS: Record<string, { kind: BrowseKind; path: string; titleKey: CategoryTitleKey }> = {
  popularTv: { kind: "tv", path: "/tv/popular", titleKey: "categoryPopularMovies" },
  topRatedTv: { kind: "tv", path: "/tv/top_rated", titleKey: "categoryTopRatedMovies" },
  onTheAirTv: { kind: "tv", path: "/tv/on_the_air", titleKey: "categoryOnTheAirTv" },
  popularMovies: { kind: "movie", path: "/movie/popular", titleKey: "categoryPopularMovies" },
  topRatedMovies: { kind: "movie", path: "/movie/top_rated", titleKey: "categoryTopRatedMovies" },
  nowPlayingMovies: { kind: "movie", path: "/movie/now_playing", titleKey: "categoryNowPlayingMovies" },
  upcomingMovies: { kind: "movie", path: "/movie/upcoming", titleKey: "categoryUpcomingMovies" },
};

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

function browseCacheKey(categoryKey: string | undefined, kind: BrowseKind, genreId: number | null): string {
  return `${categoryKey ?? kind}:${genreId ?? "none"}`;
}

// Scrollable "View all" grid — either an Explore category (?category=...,
// pages through the same TMDB list a home-screen row only shows the first
// 20 of) or a genre browse (?kind=movie|tv, optionally &genreId=... — the
// genre chips below switch this in place rather than needing a second
// screen). Infinite-scroll paginated via fetchMovieListPage/fetchTvListPage
// (lib/tmdb.ts) — TMDB caps out at 500 pages, effectively unbounded here.
export default function BrowseScreen() {
  const params = useLocalSearchParams<{ category?: string; kind?: string; genreId?: string; title?: string }>();
  const router = useRouter();
  const goBack = useGoBack("/(tabs)/explore");
  const colors = useColors();
  const { t, language } = useLanguage();
  const { width: windowWidth } = useWindowDimensions();
  const styles = useMemo(
    () => createStyles(colors, CARD_WIDTH, GRID_GAP, GRID_PADDING),
    [colors],
  );
  const numColumns = Math.max(1, Math.floor((windowWidth - GRID_PADDING * 2 + GRID_GAP) / (CARD_WIDTH + GRID_GAP)));

  const categoryConfig = params.category ? CATEGORY_PATHS[params.category] : undefined;
  const [kind, setKind] = useState<BrowseKind>(categoryConfig?.kind ?? (params.kind === "movie" ? "movie" : "tv"));
  const [genreId, setGenreId] = useState<number | null>(params.genreId ? Number(params.genreId) : null);
  const [genres, setGenres] = useState<TMDBGenre[]>([]);
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [resolving, setResolving] = useState<number | null>(null);
  const listRef = useRef<FlatList<BrowseItem>>(null);
  const cacheKey = browseCacheKey(params.category, kind, genreId);

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

  const title = categoryConfig ? t.explore[categoryConfig.titleKey] : (params.title as string) || t.explore.viewAll;

  // Genre chips — switching one resets to a fresh /discover query for that
  // genre (or back to the category's own list when "All genres" is picked
  // again), same kind (movie/tv) throughout.
  useEffect(() => {
    (kind === "movie" ? getMovieGenres(language) : getTvGenres(language)).then(setGenres).catch(() => {});
  }, [kind, language]);

  const fetchPage = useCallback(
    async (pageNum: number): Promise<BrowseItem[]> => {
      if (kind === "movie") {
        if (genreId) return fetchMovieListPage("/discover/movie", pageNum, { with_genres: String(genreId), sort_by: "popularity.desc" });
        return fetchMovieListPage(categoryConfig?.path ?? "/movie/popular", pageNum);
      }
      if (genreId) return fetchTvListPage("/discover/tv", pageNum, { with_genres: String(genreId), sort_by: "popularity.desc" });
      return fetchTvListPage(categoryConfig?.path ?? "/tv/popular", pageNum);
    },
    [kind, genreId, categoryConfig],
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
      .catch(() => active && setHasMore(false))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

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

  async function resolveTvmazeShow(item: TMDBTvResult): Promise<TVMazeShow | null> {
    const cached = resolvedTvShows.get(item.id);
    if (cached) return cached;
    const resolved = await findTvmazeShowFromTmdbTv(item.id, "high");
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
    setActionPending(item.id);
    try {
      const resolved = await resolveTvmazeShow(item);
      if (resolved) await quickAdd(resolved);
    } finally {
      setActionPending((p) => (p === item.id ? null : p));
    }
  }

  async function toggleFavoriteTmdbShow(item: TMDBTvResult) {
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
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRowOuter}
        data={[{ id: null as number | null, name: t.explore.allGenres }, ...genres.map((g) => ({ id: g.id as number | null, name: g.name }))]}
        keyExtractor={(g) => String(g.id)}
        contentContainerStyle={styles.chipRow}
        renderItem={({ item: g }) => (
          <Pressable style={[styles.chip, genreId === g.id && styles.chipActive]} onPress={() => setGenreId(g.id)}>
            <Text style={[styles.chipText, genreId === g.id && styles.chipTextActive]}>{g.name}</Text>
          </Pressable>
        )}
      />

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          // numColumns can't change on an already-mounted FlatList (RN warns
          // and ignores it) — keying by it forces a remount on the rare
          // resize that crosses a column-count boundary instead of silently
          // keeping a stale column count.
          key={`grid-${numColumns}`}
          ref={listRef}
          data={items}
          keyExtractor={(item, index) => `${item.id}-${index}`}
          numColumns={numColumns}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          onScroll={onScroll}
          scrollEventThrottle={16}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} /> : null}
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
                      hitSlop={4}
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
                      hitSlop={4}
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
      paddingTop: 56,
      paddingBottom: 12,
    },
    headerTitle: { flex: 1, textAlign: "center", fontSize: type.subtitle, fontWeight: "800", color: colors.text },
    // Without this, the FlatList's outer wrapper (as opposed to
    // contentContainerStyle, which only sizes the inner scrollable content)
    // has no height of its own to fall back on — found live: switching
    // genres drops this screen into its loading state (spinner instead of
    // the results grid below), and with nothing else in this flex:1 column
    // claiming the leftover vertical space, the chip row's ScrollView
    // stretched to fill the entire remaining screen height, turning every
    // pill into a giant vertical bar for as long as the grid was loading.
    chipRowOuter: { flexGrow: 0, flexShrink: 0 },
    chipRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 12 },
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
