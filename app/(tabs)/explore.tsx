import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, FlatList, Pressable, Animated, StyleSheet, ActivityIndicator, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { getShowsIndex, searchShows, TVMazeShow } from "../../lib/tvmaze";
import { fetchUserShows, removeUserShow, setShowFavorite, upsertUserShow } from "../../lib/userShows";
import { useColors, radius, Colors } from "../../lib/theme";
import { useLanguage, Translations } from "../../lib/i18n";
import { useScalePress, useMountIn } from "../../lib/animations";

export default function ExploreScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [shows, setShows] = useState<TVMazeShow[]>([]);
  const [searchResults, setSearchResults] = useState<TVMazeShow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  let timer: ReturnType<typeof setTimeout>;

  useEffect(() => {
    getShowsIndex(0)
      .then((data) => setShows(data.slice(0, 20)))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      fetchUserShows().then((userShows) => {
        if (!active) return;
        setAddedIds(new Set(userShows.map((s) => s.tvmaze_id)));
        setFavoriteIds(new Set(userShows.filter((s) => s.is_favorite).map((s) => s.tvmaze_id)));
      });
      return () => {
        active = false;
      };
    }, [])
  );

  function onChangeText(text: string) {
    setQuery(text);
    clearTimeout(timer);
    if (!text.trim()) {
      setSearchResults([]);
      return;
    }
    timer = setTimeout(async () => {
      const data = await searchShows(text);
      setSearchResults(data.map((d) => d.show));
    }, 400);
  }

  async function quickAdd(show: TVMazeShow) {
    const isAdded = addedIds.has(show.id);
    if (isAdded) {
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
    const isFavorite = favoriteIds.has(show.id);
    if (!addedIds.has(show.id)) {
      await upsertUserShow({
        tvmaze_id: show.id,
        show_name: show.name,
        show_image: show.image?.medium ?? null,
        status: "want_to_watch",
      });
      setAddedIds((prev) => new Set(prev).add(show.id));
    }
    await setShowFavorite(show.id, !isFavorite);
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (isFavorite) next.delete(show.id);
      else next.add(show.id);
      return next;
    });
  }

  const listData = query.trim() ? searchResults : shows;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t.explore.title}</Text>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={colors.textFaint} />
        <TextInput
          style={styles.searchInput}
          placeholder={t.explore.searchPlaceholder}
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={onChangeText}
        />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(show) => String(show.id)}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            query.trim() ? <Text style={styles.placeholder}>{t.explore.noResults(query)}</Text> : null
          }
          renderItem={({ item: show }) => (
            <ExploreCard
              show={show}
              isAdded={addedIds.has(show.id)}
              isFavorite={favoriteIds.has(show.id)}
              onPress={() => router.push(`/show/${show.id}`)}
              onToggleFavorite={() => toggleFavorite(show)}
              onQuickAdd={() => quickAdd(show)}
              colors={colors}
              styles={styles}
              t={t}
            />
          )}
        />
      )}
    </View>
  );
}

type ExploreStyles = ReturnType<typeof createStyles>;

function ExploreCard({
  show,
  isAdded,
  isFavorite,
  onPress,
  onToggleFavorite,
  onQuickAdd,
  colors,
  styles,
  t,
}: {
  show: TVMazeShow;
  isAdded: boolean;
  isFavorite: boolean;
  onPress: () => void;
  onToggleFavorite: () => void;
  onQuickAdd: () => void;
  colors: Colors;
  styles: ExploreStyles;
  t: Translations;
}) {
  const { scale, onPressIn, onPressOut } = useScalePress();
  const mountIn = useMountIn();

  return (
    <Pressable style={styles.card} onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress}>
      <Animated.View style={{ opacity: mountIn.opacity, transform: [...mountIn.transform, { scale }] }}>
        <View style={styles.cardImageWrap}>
          {show.image ? (
            <Image source={{ uri: show.image.medium }} style={styles.cardImage} resizeMode="cover" />
          ) : (
            <View style={[styles.cardImage, styles.cardImagePlaceholder]} />
          )}
          <View style={styles.cardActions}>
            <Pressable
              style={styles.iconBtn}
              onPress={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
            >
              <Ionicons
                name={isFavorite ? "heart" : "heart-outline"}
                size={15}
                color={isFavorite ? colors.red : "#fff"}
              />
            </Pressable>
            <Pressable
              style={[styles.iconBtn, isAdded && styles.iconBtnActive]}
              onPress={(e) => {
                e.stopPropagation();
                onQuickAdd();
              }}
            >
              <Ionicons name={isAdded ? "checkmark" : "add"} size={16} color={isAdded ? colors.onAccent : "#fff"} />
            </Pressable>
          </View>
        </View>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {show.name}
        </Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {show.status === "Ended" ? t.explore.ended : t.explore.running}
          {show.network ? ` · ${show.network.name}` : ""}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    title: { fontSize: 22, fontWeight: "800", color: colors.text, paddingHorizontal: 16, paddingTop: 20 },
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginHorizontal: 16,
      marginTop: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.backgroundAlt,
      borderRadius: radius.sm,
    },
    searchInput: { flex: 1, fontSize: 15, color: colors.text },
    grid: { padding: 16, paddingTop: 8, gap: 16 },
    row: { gap: 16 },
    card: { flex: 1 },
    cardImageWrap: { position: "relative" },
    cardImage: {
      width: "100%",
      aspectRatio: 2 / 3,
      borderRadius: radius.md,
      backgroundColor: colors.backgroundAlt,
    },
    cardImagePlaceholder: { backgroundColor: colors.backgroundAlt },
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
    cardTitle: { color: colors.text, fontWeight: "700", fontSize: 13, marginTop: 8 },
    cardMeta: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
    placeholder: { color: colors.textMuted, textAlign: "center", marginTop: 40 },
  });
}
