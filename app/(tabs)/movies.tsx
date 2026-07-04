import { useCallback, useMemo, useState } from "react";
import { View, Text, FlatList, StyleSheet } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { fetchUserMovies, UserMovie } from "../../lib/userMovies";
import { MovieCard } from "../../components/MovieCard";
import { useColors, Colors } from "../../lib/theme";

export default function MoviesScreen() {
  const [movies, setMovies] = useState<UserMovie[]>([]);
  const [loaded, setLoaded] = useState(false);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  useFocusEffect(
    useCallback(() => {
      fetchUserMovies()
        .then(setMovies)
        .finally(() => setLoaded(true));
    }, [])
  );

  if (loaded && movies.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="film-outline" size={40} color={colors.textFaint} />
        <Text style={styles.title}>Films</Text>
        <Text style={styles.subtitle}>Aucun film pour l'instant.</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.grid}
      data={movies}
      keyExtractor={(m) => m.id}
      numColumns={3}
      columnWrapperStyle={styles.row}
      renderItem={({ item }) => (
        <MovieCard title={item.title} year={item.year} watchedAt={item.watched_at} timesWatched={item.times_watched} />
      )}
    />
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    grid: { padding: 16 },
    row: { gap: 12, marginBottom: 16 },
    empty: { flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", gap: 8 },
    title: { fontSize: 20, fontWeight: "800", color: colors.text },
    subtitle: { color: colors.textMuted },
  });
}
