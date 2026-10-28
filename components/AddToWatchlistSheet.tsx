import { useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { searchShows, TVMazeShow } from "../lib/tvmaze";
import { searchMovies, posterUrl, TMDBSearchResult } from "../lib/tmdb";
import { addShowToRoomWatchlist, addMovieToRoomWatchlist } from "../lib/rooms";
import { Pill } from "./Pill";

type Mode = "show" | "movie";

interface AddToWatchlistSheetProps {
  roomId: string;
  onAdded: () => void;
  onClose: () => void;
}

// Lets a member queue something the room hasn't started yet ("we want to
// watch this together") — unlike AddWatchTogetherSheet, which logs
// something already watched episode by episode, this is just a search and
// a tap: no season/episode picker, nothing marked watched for anyone.
export function AddToWatchlistSheet({ roomId, onAdded, onClose }: AddToWatchlistSheetProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const [mode, setMode] = useState<Mode>("show");

  const [showQuery, setShowQuery] = useState("");
  const [showResults, setShowResults] = useState<TVMazeShow[]>([]);
  const [movieQuery, setMovieQuery] = useState("");
  const [movieResults, setMovieResults] = useState<TMDBSearchResult[]>([]);
  const [adding, setAdding] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setShowQuery("");
    setShowResults([]);
    setMovieQuery("");
    setMovieResults([]);
  }

  function onShowQueryChange(text: string) {
    setShowQuery(text);
    if (!text.trim()) {
      setShowResults([]);
      return;
    }
    searchShows(text.trim()).then((found) => setShowResults(found.map((r) => r.show)));
  }

  function onMovieQueryChange(text: string) {
    setMovieQuery(text);
    if (!text.trim()) {
      setMovieResults([]);
      return;
    }
    searchMovies(text.trim()).then((found) => setMovieResults(found.slice(0, 6)));
  }

  async function addShow(show: TVMazeShow) {
    if (adding) return;
    setAdding(true);
    try {
      await addShowToRoomWatchlist(roomId, show);
      onAdded();
      onClose();
    } finally {
      setAdding(false);
    }
  }

  async function addMovie(movie: TMDBSearchResult) {
    if (adding) return;
    setAdding(true);
    try {
      await addMovieToRoomWatchlist(roomId, movie);
      onAdded();
      onClose();
    } finally {
      setAdding(false);
    }
  }

  return (
    <View>
      <Text style={styles.sheetTitle}>{t.rooms.addToWatchlistTitle}</Text>
      <View style={styles.modeRow}>
        <Pill size="sm" tone={mode === "show" ? "solid" : "neutral"} onPress={() => switchMode("show")}>
          {t.rooms.addWatchedShow}
        </Pill>
        <Pill size="sm" tone={mode === "movie" ? "solid" : "neutral"} onPress={() => switchMode("movie")}>
          {t.rooms.addWatchedMovie}
        </Pill>
      </View>

      {mode === "show" ? (
        <>
          <TextInput
            style={styles.searchInput}
            placeholder={t.rooms.addWatchedShowPlaceholder}
            textContentType="none"
            autoComplete="off"
            importantForAutofill="no"
            placeholderTextColor={colors.textFaint}
            value={showQuery}
            onChangeText={onShowQueryChange}
          />
          {showResults.slice(0, 6).map((show) => (
            <Pressable key={show.id} style={styles.resultRow} disabled={adding} onPress={() => addShow(show)}>
              {show.image?.medium && <Image source={{ uri: show.image.medium }} style={styles.resultImage} />}
              <Text style={styles.resultName} numberOfLines={1}>
                {show.name}
              </Text>
            </Pressable>
          ))}
        </>
      ) : (
        <>
          <TextInput
            style={styles.searchInput}
            placeholder={t.rooms.addWatchedMoviePlaceholder}
            textContentType="none"
            autoComplete="off"
            importantForAutofill="no"
            placeholderTextColor={colors.textFaint}
            value={movieQuery}
            onChangeText={onMovieQueryChange}
          />
          {movieResults.map((movie) => {
            const poster = posterUrl(movie.poster_path, "w200");
            return (
              <Pressable key={movie.id} style={styles.resultRow} disabled={adding} onPress={() => addMovie(movie)}>
                {poster && <Image source={{ uri: poster }} style={styles.resultImage} />}
                <Text style={styles.resultName} numberOfLines={1}>
                  {movie.title}
                  {movie.release_date ? ` (${movie.release_date.slice(0, 4)})` : ""}
                </Text>
              </Pressable>
            );
          })}
        </>
      )}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    sheetTitle: { textAlign: "center", fontWeight: "800", fontSize: 13, color: colors.textMuted, letterSpacing: 0.5, marginBottom: 16 },
    modeRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
    searchInput: {
      backgroundColor: colors.backgroundAlt,
      borderRadius: radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: type.input,
      color: colors.text,
      marginBottom: 8,
    },
    resultRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
    resultImage: { width: 32, height: 46, borderRadius: radius.sm, backgroundColor: colors.backgroundAlt },
    resultName: { fontWeight: "700", fontSize: type.body, color: colors.text, flex: 1 },
  });
}
