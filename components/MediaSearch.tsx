import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { searchShows, TVMazeShow } from "../lib/tvmaze";
import { searchMovies, posterUrl, TMDBSearchResult } from "../lib/tmdb";

interface MediaSearchProps {
  onPickShow: (show: TVMazeShow) => void;
  onPickMovie: (movie: TMDBSearchResult) => void;
  disabled?: boolean;
  // Already in whatever list this search feeds — shown with a check
  // instead of being offered again.
  existingShowIds?: Set<number>;
  existingMovieIds?: Set<number>;
}

const MAX_PER_KIND = 5;

// One field for shows and movies at once, the same way Explore's search
// works (app/(tabs)/explore.tsx) — the room sheets used to make you pick
// "Show" or "Movie" first and then search only that, which meant guessing
// how TVmaze/TMDB classify something before you could even look for it.
// Debounced, and a slower stale response never overwrites a newer one.
export function MediaSearch({ onPickShow, onPickMovie, disabled, existingShowIds, existingMovieIds }: MediaSearchProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [shows, setShows] = useState<TVMazeShow[]>([]);
  const [movies, setMovies] = useState<TMDBSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  function onChangeText(text: string) {
    setQuery(text);
    clearTimeout(timer.current);
    const q = text.trim();
    const gen = ++generation.current;
    if (!q) {
      setSearching(false);
      setShows([]);
      setMovies([]);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const [foundShows, foundMovies] = await Promise.all([
        searchShows(q).catch(() => []),
        searchMovies(q).catch(() => []),
      ]);
      if (gen !== generation.current) return;
      setShows(foundShows.map((r) => r.show).slice(0, MAX_PER_KIND));
      setMovies(foundMovies.slice(0, MAX_PER_KIND));
      setSearching(false);
    }, 300);
  }

  const hasQuery = !!query.trim();
  const noResults = hasQuery && !searching && shows.length === 0 && movies.length === 0;

  function renderRow(key: string, image: string | null, title: string, meta: string | null, icon: "tv-outline" | "film-outline", added: boolean, onPress: () => void) {
    return (
      <Pressable key={key} style={styles.resultRow} disabled={disabled || added} onPress={onPress} accessibilityRole="button">
        {image ? (
          <Image source={{ uri: image }} style={styles.poster} contentFit="cover" />
        ) : (
          <View style={[styles.poster, styles.posterPlaceholder]}>
            <Ionicons name={icon} size={14} color={colors.textFaint} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.resultName} numberOfLines={1}>
            {title}
          </Text>
          {meta && (
            <Text style={styles.resultMeta} numberOfLines={1}>
              {meta}
            </Text>
          )}
        </View>
        <Ionicons
          name={added ? "checkmark-circle" : "add-circle-outline"}
          size={22}
          color={added ? colors.green : colors.accent}
        />
      </Pressable>
    );
  }

  return (
    <View>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.textFaint} />
        <TextInput
          style={styles.searchInput}
          placeholder={t.explore.searchPlaceholder}
          // Keeps the browser/password manager from attaching an autofill
          // dropdown that covers the results below.
          textContentType="none"
          autoComplete="off"
          importantForAutofill="no"
          autoCorrect={false}
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={onChangeText}
        />
        {hasQuery && (
          <Pressable onPress={() => onChangeText("")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={colors.textFaint} />
          </Pressable>
        )}
      </View>

      {searching && shows.length === 0 && movies.length === 0 ? (
        <ActivityIndicator color={colors.textMuted} style={{ marginVertical: 16 }} />
      ) : noResults ? (
        <Text style={styles.empty}>{t.explore.noResults(query.trim())}</Text>
      ) : (
        <>
          {shows.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>{t.explore.resultsShows}</Text>
              {shows.map((show) =>
                renderRow(
                  `show-${show.id}`,
                  show.image?.medium ?? null,
                  show.name,
                  [show.premiered?.slice(0, 4), show.network?.name ?? show.webChannel?.name].filter(Boolean).join(" · ") || null,
                  "tv-outline",
                  !!existingShowIds?.has(show.id),
                  () => onPickShow(show),
                ),
              )}
            </>
          )}
          {movies.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>{t.explore.resultsMovies}</Text>
              {movies.map((movie) =>
                renderRow(
                  `movie-${movie.id}`,
                  posterUrl(movie.poster_path, "w200"),
                  movie.title,
                  movie.release_date ? movie.release_date.slice(0, 4) : null,
                  "film-outline",
                  !!existingMovieIds?.has(movie.id),
                  () => onPickMovie(movie),
                ),
              )}
            </>
          )}
        </>
      )}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.backgroundAlt,
      borderRadius: radius.sm,
      marginBottom: 8,
    },
    searchInput: { flex: 1, fontSize: type.input, color: colors.text },
    sectionLabel: {
      fontSize: type.caption,
      fontWeight: "800",
      color: colors.textMuted,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      marginTop: 10,
      marginBottom: 2,
    },
    resultRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
    poster: { width: 34, height: 50, borderRadius: radius.sm, backgroundColor: colors.backgroundAlt },
    posterPlaceholder: { alignItems: "center", justifyContent: "center" },
    resultName: { fontWeight: "700", fontSize: type.body, color: colors.text },
    resultMeta: { fontSize: type.caption, color: colors.textMuted, marginTop: 2 },
    empty: { fontSize: type.bodySm, color: colors.textMuted, marginVertical: 12, textAlign: "center" },
  });
}
