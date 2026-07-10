import { useMemo } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";

export interface RecommendationItem {
  key: number;
  title: string;
  posterUrl: string | null;
  onPress: () => void;
}

// "You might also like" — shared by movie and show detail (see
// app/movie/tmdb/[id].tsx and app/show/[id].tsx), same shape either way
// (see RecommendationItem) so this doesn't need to know which one it's on.
export function RecommendationsRow({ items }: { items: RecommendationItem[] }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();

  if (items.length === 0) return null;

  return (
    <View>
      <Text style={styles.sectionHeader}>{t.common.youMightAlsoLike}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {items.map((item) => (
          <Pressable key={item.key} style={styles.card} onPress={item.onPress}>
            {item.posterUrl ? (
              <Image source={{ uri: item.posterUrl }} style={styles.poster} contentFit="cover" />
            ) : (
              <View style={[styles.poster, styles.posterPlaceholder]} />
            )}
            <Text style={styles.title} numberOfLines={2}>
              {item.title}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    sectionHeader: { color: colors.text, fontSize: type.subtitle, fontWeight: "800", marginTop: 24, marginBottom: 8 },
    card: { width: 96, marginRight: 12 },
    poster: { width: 96, height: 136, borderRadius: radius.sm, backgroundColor: colors.backgroundAlt },
    posterPlaceholder: {},
    title: { fontSize: 12, fontWeight: "700", color: colors.text, marginTop: 6 },
  });
}
