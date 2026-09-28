import { useEffect, useMemo, useRef, useState } from "react";
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
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, Colors } from "../../../lib/theme";
import { useLanguage } from "../../../lib/i18n";
import { fetchFavorites, fetchUserShows, fetchListItems } from "../../../lib/userShows";
import { fetchPublicWatchedMovies, fetchPublicFavoriteMovies, PublicMovie } from "../../../lib/userMovies";
import { posterUrl } from "../../../lib/tmdb";
import { ShowCard } from "../../../components/ShowCard";
import { EmptyState } from "../../../components/EmptyState";
import { useGoBack } from "../../../lib/useGoBack";

type ListType = "shows" | "favorites" | "movies" | "favoriteMovies" | "paused" | "dropped" | "list";

// Common shape ShowCard actually reads (id/tvmaze_id/show_name/show_image) —
// both UserShow and ListItem are structural supersets of this, so results
// from fetchUserShows/fetchFavorites (own-profile status sections) and
// fetchListItems (a single custom list, "list" type below) can share this
// screen's one "shows" grid without an adapter/mapping step.
interface ShowCardSource {
  id: string;
  tvmaze_id: number;
  show_name: string;
  show_image: string | null;
}

// ShowCard itself is a fixed 110px card with its own built-in 12px
// marginRight (see components/ShowCard.tsx — it's normally used inside a
// horizontal scroll row, where that margin is the only spacing mechanism).
// This grid used a numColumns={3}/flex:1/3 column that just meant "1/3 of
// the screen width" regardless of that, so a wide/desktop viewport ended up
// with 3 huge, mostly-empty columns each centering one small card (see
// app/browse.tsx's identical bug/fix, applied here the same way: size each
// column to the card's own real footprint and compute how many fit,
// **without** adding a second gap on top of ShowCard's own margin).
const CARD_WIDTH = 110;
const CARD_MARGIN_RIGHT = 12;
const GRID_PADDING = 12;

// Same reasoning as browse.tsx's own browseStateCache — this app's web
// build remounts a screen from scratch on back-navigation, so the fetched
// list and scroll position both need to live outside the component to
// survive a tap-into-a-card-then-back round trip.
interface ListCacheEntry {
  shows: ShowCardSource[];
  movies: PublicMovie[];
  scrollOffset: number;
}
const userListCache = new Map<string, ListCacheEntry>();

// The scrollable "view all" a profile's own Favorites/Shows/Movies rows
// (app/users/[id]/index.tsx, and app/(tabs)/profile.tsx's own copies) link
// out to — those stay a single horizontal row (a profile has 4 of them
// already; a full-height grid for every one would make the profile itself
// unreasonably long), this is where "see everything" actually happens.
// Re-fetches the same already-existing per-user functions those rows use
// rather than being handed the list through navigation params — these can
// run into the hundreds of entries, too much to serialize through a route.
export default function UserListScreen() {
  const { id, type, title, listId, back } = useLocalSearchParams<{
    id: string;
    type: ListType;
    title?: string;
    // Only set (and only meaningful) for type "list" — which custom list to
    // load (see lib/userShows.ts's fetchListItems). RLS scopes list_items to
    // its owner, so this only ever resolves to something for your own id.
    listId?: string;
    // "profile" when this was opened from the own Profile tab rather than
    // from viewing someone else's /users/[id] — closing back to /users/{id}
    // would land on the "viewing someone else" version of your own profile
    // instead of the actual Profile tab, so that one case needs its own
    // fallback. Only matters on a hard refresh landing directly here;
    // otherwise goBack's router.back() already returns wherever this was
    // opened from regardless of this fallback.
    back?: string;
  }>();
  const router = useRouter();
  const goBack = useGoBack(back === "profile" ? "/(tabs)/profile" : `/users/${id}`);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const { width: windowWidth } = useWindowDimensions();
  const numColumns = Math.max(1, Math.floor((windowWidth - GRID_PADDING * 2) / (CARD_WIDTH + CARD_MARGIN_RIGHT)));
  const [shows, setShows] = useState<ShowCardSource[]>([]);
  const [movies, setMovies] = useState<PublicMovie[]>([]);
  const [loading, setLoading] = useState(true);
  const showsListRef = useRef<FlatList<ShowCardSource>>(null);
  const moviesListRef = useRef<FlatList<PublicMovie>>(null);
  const cacheKey = type === "list" ? `${id}:list:${listId ?? ""}` : `${id}:${type}`;

  const isMovieList = type === "movies" || type === "favoriteMovies";

  useEffect(() => {
    const cached = userListCache.get(cacheKey);
    if (cached) {
      setShows(cached.shows);
      setMovies(cached.movies);
      setLoading(false);
      requestAnimationFrame(() => {
        showsListRef.current?.scrollToOffset({ offset: cached.scrollOffset, animated: false });
        moviesListRef.current?.scrollToOffset({ offset: cached.scrollOffset, animated: false });
      });
      return;
    }

    let active = true;
    setLoading(true);
    function applyShows(r: ShowCardSource[]) {
      if (!active) return;
      setShows(r);
      userListCache.set(cacheKey, { shows: r, movies: [], scrollOffset: 0 });
    }
    const load =
      type === "favorites"
        ? fetchFavorites(id).then(applyShows)
        : type === "shows"
          ? fetchUserShows(id).then(applyShows)
          : type === "paused"
            ? fetchUserShows(id).then((r) => applyShows(r.filter((s) => s.status === "paused")))
            : type === "dropped"
              ? fetchUserShows(id).then((r) => applyShows(r.filter((s) => s.status === "dropped")))
              : type === "list"
                ? listId
                  ? fetchListItems(listId).then(applyShows)
                  : Promise.resolve(applyShows([]))
                : type === "favoriteMovies"
                  ? fetchPublicFavoriteMovies(id).then((r) => {
                      if (!active) return;
                      setMovies(r);
                      userListCache.set(cacheKey, { shows: [], movies: r, scrollOffset: 0 });
                    })
                  : fetchPublicWatchedMovies(id).then((r) => {
                      if (!active) return;
                      setMovies(r);
                      userListCache.set(cacheKey, { shows: [], movies: r, scrollOffset: 0 });
                    });
    load.finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  // See app/browse.tsx's identical navigatingAwayRef for why this exists —
  // the native touch on a card fires a spurious scroll-to-0 event before
  // navigation, which without this guard clobbers the real scroll offset
  // right before it's cached.
  const navigatingAwayRef = useRef(false);
  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (navigatingAwayRef.current) return;
    const entry = userListCache.get(cacheKey);
    if (entry) entry.scrollOffset = e.nativeEvent.contentOffset.y;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title || t.explore.viewAll}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 32 }} />
      ) : isMovieList ? (
        movies.length === 0 ? (
          <EmptyState icon="film-outline" title={t.profile.noMovies} />
        ) : (
          <FlatList
            key={`grid-${numColumns}`}
            ref={moviesListRef}
            data={movies}
            keyExtractor={(m) => String(m.tmdb_id)}
            numColumns={numColumns}
            columnWrapperStyle={styles.row}
            contentContainerStyle={styles.grid}
            onScroll={onScroll}
            scrollEventThrottle={16}
            renderItem={({ item: m }) => (
              <View style={styles.cardWrap}>
                <ShowCard
                  id={m.tmdb_id}
                  name={m.title}
                  imageUrl={posterUrl(m.poster_path, "w200")}
                  onNavigateAway={() => {
                    navigatingAwayRef.current = true;
                  }}
                  onPress={() => router.push(`/movie/tmdb/${m.tmdb_id}`)}
                />
              </View>
            )}
          />
        )
      ) : shows.length === 0 ? (
        <EmptyState icon="tv-outline" title={t.profile.noShows} />
      ) : (
        <FlatList
          key={`grid-${numColumns}`}
          ref={showsListRef}
          data={shows}
          keyExtractor={(s) => s.id}
          numColumns={numColumns}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          onScroll={onScroll}
          scrollEventThrottle={16}
          renderItem={({ item: s }) => (
            <View style={styles.cardWrap}>
              <ShowCard
                id={s.tvmaze_id}
                name={s.show_name}
                imageUrl={s.show_image}
                onNavigateAway={() => {
                  navigatingAwayRef.current = true;
                }}
              />
            </View>
          )}
        />
      )}
    </View>
  );
}

function createStyles(colors: Colors) {
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
    grid: { paddingHorizontal: GRID_PADDING, paddingBottom: 32 },
    // No gap here — ShowCard already carries its own marginRight (see the
    // CARD_MARGIN_RIGHT comment above); adding a second gap on top of it
    // would double-space every column.
    row: { justifyContent: "center" },
    cardWrap: { marginBottom: 16 },
  });
}
