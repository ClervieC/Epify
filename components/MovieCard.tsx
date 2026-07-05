import { useMemo } from "react";
import { View, Text, Animated, StyleSheet } from "react-native";
import { useColors, radius, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { useMountIn } from "../lib/animations";

interface MovieCardProps {
  title: string;
  year: number | null;
  watchedAt: string;
  timesWatched: number;
}

export function MovieCard({ title, year, watchedAt, timesWatched }: MovieCardProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const mountIn = useMountIn();
  const watchedDate = new Date(watchedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Animated.View style={[styles.card, { opacity: mountIn.opacity, transform: mountIn.transform }]}>
      <View style={[styles.image, styles.placeholder]}>
        <Text style={styles.placeholderText}>{title[0]}</Text>
      </View>
      <Text style={styles.name} numberOfLines={2}>
        {title}
        {year ? ` (${year})` : ""}
      </Text>
      <Text style={styles.subtitle} numberOfLines={1}>
        {t.movies.watchedOn(watchedDate)}
        {timesWatched > 1 ? ` · ${timesWatched}x` : ""}
      </Text>
    </Animated.View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    card: { flex: 1 },
    image: { width: "100%", aspectRatio: 110 / 155, borderRadius: radius.sm, backgroundColor: colors.backgroundAlt },
    placeholder: { alignItems: "center", justifyContent: "center" },
    placeholderText: { color: colors.textFaint, fontSize: 30, fontWeight: "700" },
    name: { color: colors.text, fontSize: 13, fontWeight: "600", marginTop: 6 },
    subtitle: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  });
}
