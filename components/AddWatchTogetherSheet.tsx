import { useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, Image, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { searchShows, getShowEpisodes, TVMazeShow, TVMazeEpisode } from "../lib/tvmaze";
import { searchMovies, posterUrl, TMDBSearchResult } from "../lib/tmdb";
import { setEpisodeWatched, markEpisodeWatchedForRoom } from "../lib/userShows";
import { setMovieWatched, markMovieWatchedForRoom } from "../lib/userMovies";
import { Pill } from "./Pill";

type Mode = "show" | "movie";

interface AddWatchTogetherSheetProps {
  roomId: string;
  // Every OTHER accepted member of this one room — sharing from here always
  // means exactly this room (there's no room picker, unlike RoomSharePicker
  // elsewhere), which is exactly the case mark_*_watched_for_room's
  // p_room_ids param exists for (see its own comment in supabase/
  // schema.sql).
  otherMemberUserIds: string[];
  onAdded: () => void;
  onClose: () => void;
}

// Lets a member log something the room already watched together directly
// from the room screen, instead of only ever being offered the share
// choice after marking it watched on a show/episode/movie page first. Marks
// it watched for the current user the same way those pages do (setEpisode
// Watched/setMovieWatched), then fans it out to the rest of the room the
// same way their "share with room" confirm does.
export function AddWatchTogetherSheet({ roomId, otherMemberUserIds, onAdded, onClose }: AddWatchTogetherSheetProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const [mode, setMode] = useState<Mode>("show");

  const [showQuery, setShowQuery] = useState("");
  const [showResults, setShowResults] = useState<TVMazeShow[]>([]);
  const [selectedShow, setSelectedShow] = useState<TVMazeShow | null>(null);
  const [episodes, setEpisodes] = useState<TVMazeEpisode[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);

  const [movieQuery, setMovieQuery] = useState("");
  const [movieResults, setMovieResults] = useState<TMDBSearchResult[]>([]);

  const [submitting, setSubmitting] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setShowQuery("");
    setShowResults([]);
    setSelectedShow(null);
    setEpisodes([]);
    setExpandedSeason(null);
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

  async function selectShow(show: TVMazeShow) {
    setSelectedShow(show);
    setShowResults([]);
    setLoadingEpisodes(true);
    const eps = await getShowEpisodes(show.id);
    setEpisodes(eps);
    setLoadingEpisodes(false);
    // The latest aired season, not season 1 — that's the one someone
    // adding a show here almost always means to pick an episode from.
    const airedSeasons = [
      ...new Set(eps.filter((e) => !!e.airstamp && new Date(e.airstamp).getTime() <= Date.now()).map((e) => e.season)),
    ];
    setExpandedSeason(airedSeasons.at(-1) ?? null);
  }

  async function addEpisode(ep: TVMazeEpisode) {
    if (!selectedShow || submitting) return;
    setSubmitting(true);
    try {
      await setEpisodeWatched({
        tvmaze_show_id: selectedShow.id,
        tvmaze_episode_id: ep.id,
        season: ep.season,
        number: ep.number,
        watched: true,
      });
      if (otherMemberUserIds.length > 0) {
        await markEpisodeWatchedForRoom([roomId], otherMemberUserIds, selectedShow.id, ep.id, ep.season, ep.number);
      }
      onAdded();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  function onMovieQueryChange(text: string) {
    setMovieQuery(text);
    if (!text.trim()) {
      setMovieResults([]);
      return;
    }
    searchMovies(text.trim()).then((found) => setMovieResults(found.slice(0, 6)));
  }

  async function addMovie(movie: TMDBSearchResult) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const year = movie.release_date ? Number(movie.release_date.slice(0, 4)) : null;
      await setMovieWatched(movie.title, year, true, movie.id, movie.poster_path);
      if (otherMemberUserIds.length > 0) {
        await markMovieWatchedForRoom([roomId], otherMemberUserIds, movie.id, movie.title, year, movie.poster_path);
      }
      onAdded();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const seasons = [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b);

  return (
    <View>
      <Text style={styles.sheetTitle}>{t.rooms.addWatchedTitle}</Text>
      <View style={styles.modeRow}>
        <Pill size="sm" tone={mode === "show" ? "solid" : "neutral"} onPress={() => switchMode("show")}>
          {t.rooms.addWatchedShow}
        </Pill>
        <Pill size="sm" tone={mode === "movie" ? "solid" : "neutral"} onPress={() => switchMode("movie")}>
          {t.rooms.addWatchedMovie}
        </Pill>
      </View>

      {mode === "show" ? (
        selectedShow ? (
          <>
            <View style={styles.selectedRow}>
              {selectedShow.image?.medium && <Image source={{ uri: selectedShow.image.medium }} style={styles.selectedImage} />}
              <Text style={styles.selectedName} numberOfLines={1}>
                {selectedShow.name}
              </Text>
              <Pressable
                onPress={() => {
                  setSelectedShow(null);
                  setEpisodes([]);
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t.rooms.linkShowClear}
              >
                <Ionicons name="close-circle" size={20} color={colors.textFaint} />
              </Pressable>
            </View>
            {loadingEpisodes ? (
              <ActivityIndicator color={colors.textMuted} style={{ marginVertical: 16 }} />
            ) : (
              seasons.map((seasonNum) => {
                const eps = episodes.filter((e) => e.season === seasonNum);
                const expanded = expandedSeason === seasonNum;
                return (
                  <View key={seasonNum}>
                    <Pressable style={styles.seasonRow} onPress={() => setExpandedSeason(expanded ? null : seasonNum)}>
                      <Text style={styles.seasonTitle}>{t.showDetail.season(seasonNum)}</Text>
                      <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.text} />
                    </Pressable>
                    {expanded &&
                      eps.map((ep) => (
                        <Pressable key={ep.id} style={styles.episodeRow} disabled={submitting} onPress={() => addEpisode(ep)}>
                          <Text style={styles.episodeText} numberOfLines={1}>
                            E{ep.number} · {ep.name}
                          </Text>
                        </Pressable>
                      ))}
                  </View>
                );
              })
            )}
          </>
        ) : (
          <>
            <TextInput
              style={styles.searchInput}
              placeholder={t.rooms.addWatchedShowPlaceholder}
              // Same as app/users/search.tsx — keeps the browser/password manager
              // from attaching an autofill dropdown that covers the results below.
              textContentType="none"
              autoComplete="off"
              importantForAutofill="no"
              placeholderTextColor={colors.textFaint}
              value={showQuery}
              onChangeText={onShowQueryChange}
            />
            {showResults.slice(0, 6).map((show) => (
              <Pressable key={show.id} style={styles.resultRow} onPress={() => selectShow(show)}>
                {show.image?.medium && <Image source={{ uri: show.image.medium }} style={styles.selectedImage} />}
                <Text style={styles.selectedName} numberOfLines={1}>
                  {show.name}
                </Text>
              </Pressable>
            ))}
          </>
        )
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
              <Pressable key={movie.id} style={styles.resultRow} disabled={submitting} onPress={() => addMovie(movie)}>
                {poster && <Image source={{ uri: poster }} style={styles.selectedImage} />}
                <Text style={styles.selectedName} numberOfLines={1}>
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
    selectedRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
    selectedImage: { width: 32, height: 46, borderRadius: radius.sm, backgroundColor: colors.backgroundAlt },
    selectedName: { fontWeight: "700", fontSize: type.body, color: colors.text, flex: 1 },
    seasonRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    seasonTitle: { fontWeight: "800", fontSize: type.body, color: colors.text },
    episodeRow: { paddingVertical: 8, paddingLeft: 8 },
    episodeText: { fontSize: type.bodySm, color: colors.textMuted },
  });
}
