import { useMemo } from "react";
import { View, Text, Pressable, Image, Animated, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { useScalePress } from "../lib/animations";
import { WatchedCheck } from "./WatchedCheck";

interface EpisodeRowProps {
  showId: number;
  showName: string;
  showImage: string | null;
  episodeId: number;
  season: number;
  number: number;
  extraEpisodes?: number;
  title: string;
  isPremiere?: boolean;
  isNew?: boolean;
  hasAired?: boolean;
  watched: boolean;
  timesWatched?: number;
  time?: string;
  network?: string;
  daysAway?: number;
  dimmed?: boolean;
  onToggleWatched: () => void;
  onRewatch?: () => void;
  onPress?: () => void;
}

export function EpisodeRow({
  showId,
  showName,
  showImage,
  episodeId,
  season,
  number,
  extraEpisodes,
  title,
  isPremiere,
  isNew,
  hasAired,
  watched,
  timesWatched,
  time,
  network,
  daysAway,
  dimmed,
  onToggleWatched,
  onRewatch,
  onPress,
}: EpisodeRowProps) {
  const router = useRouter();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const { scale, onPressIn, onPressOut } = useScalePress(0.97);

  const openEpisode =
    onPress ??
    (() =>
      router.push({
        pathname: "/episode/[id]",
        params: { id: String(episodeId), showId: String(showId) },
      }));

  return (
    <Pressable onPressIn={onPressIn} onPressOut={onPressOut} onPress={openEpisode}>
      <Animated.View style={[styles.row, dimmed && styles.rowDimmed, { transform: [{ scale }] }]}>
      {showImage ? (
        <Image source={{ uri: showImage }} style={[styles.thumb, dimmed && styles.thumbDimmed]} />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder, dimmed && styles.thumbDimmed]} />
      )}
      <View style={styles.info}>
        <Pressable
          style={[styles.showPill, dimmed && styles.showPillDimmed]}
          onPress={(e) => {
            e.stopPropagation();
            router.push(`/show/${showId}`);
          }}
        >
          <Text style={[styles.showPillText, dimmed && styles.textDimmed]} numberOfLines={1}>
            {showName.toUpperCase()}
          </Text>
          <Ionicons name="chevron-forward" size={12} color={dimmed ? colors.textFaint : colors.text} />
        </Pressable>
        <Text style={[styles.episodeCode, dimmed && styles.textDimmed]}>
          S{String(season).padStart(2, "0")} | E{String(number).padStart(2, "0")}
          {extraEpisodes ? <Text style={styles.extraEpisodes}> +{extraEpisodes}</Text> : null}
        </Text>
        <Text style={styles.episodeTitle} numberOfLines={1}>
          {title}
        </Text>
        {!dimmed && (
          <View style={styles.badgeRow}>
            {isPremiere && (
              <View style={[styles.badge, { backgroundColor: colors.badgePremiere }]}>
                <Text style={[styles.badgeText, { color: "#fff" }]}>{t.episodeRow.premiere}</Text>
              </View>
            )}
            {isNew && (
              <View style={[styles.badge, { backgroundColor: colors.badgeNew }]}>
                <Text style={[styles.badgeText, { color: colors.onAccent }]}>{t.episodeRow.new}</Text>
              </View>
            )}
            {hasAired && (
              <View style={[styles.badge, { backgroundColor: colors.badgeAired }]}>
                <Text style={[styles.badgeText, { color: "#fff" }]}>{t.episodeRow.aired}</Text>
              </View>
            )}
          </View>
        )}
      </View>

      {daysAway !== undefined ? (
        <View style={styles.timeCol}>
          <Text style={styles.daysAwayNumber}>{daysAway}</Text>
          <Text style={styles.daysAwayLabel}>{t.episodeRow.days}</Text>
        </View>
      ) : time ? (
        <View style={styles.timeCol}>
          <Text style={styles.time}>{time}</Text>
          {network && <Text style={styles.network}>{network}</Text>}
        </View>
      ) : (
        <View style={styles.checkCol}>
          <WatchedCheck
            watched={watched}
            timesWatched={timesWatched}
            onToggle={onToggleWatched}
            onRewatch={onRewatch}
            light={dimmed}
          />
        </View>
      )}
      </Animated.View>
    </Pressable>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      overflow: "hidden",
      marginBottom: 12,
      shadowColor: "#000",
      shadowOpacity: 0.06,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
    rowDimmed: { backgroundColor: "transparent", shadowOpacity: 0 },
    thumb: { width: 88, alignSelf: "stretch", backgroundColor: colors.backgroundAlt },
    thumbDimmed: { opacity: 0.45 },
    thumbPlaceholder: { backgroundColor: colors.backgroundAlt },
    info: { flex: 1, gap: 3, padding: 12 },
    showPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      alignSelf: "flex-start",
      borderWidth: 1,
      borderColor: colors.black,
      borderRadius: radius.pill,
      paddingHorizontal: 8,
      paddingVertical: 2,
      maxWidth: "100%",
    },
    showPillDimmed: { borderColor: colors.border },
    textDimmed: { color: colors.textFaint },
    showPillText: { fontSize: 10, fontWeight: "800", color: colors.text },
    episodeCode: { fontWeight: "800", fontSize: 15, color: colors.text, marginTop: 2 },
    extraEpisodes: { fontWeight: "400", color: colors.textMuted },
    episodeTitle: { color: colors.textMuted, fontSize: 13 },
    badgeRow: { flexDirection: "row", gap: 6, marginTop: 4 },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
    badgeText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.3 },
    timeCol: { alignItems: "flex-end", justifyContent: "center", paddingRight: 12 },
    time: { fontWeight: "700", fontSize: 12, color: colors.text },
    network: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
    daysAwayNumber: { fontWeight: "800", fontSize: 24, color: colors.text },
    daysAwayLabel: { fontSize: 10, fontWeight: "700", color: colors.textMuted, marginTop: 1 },
    checkCol: { justifyContent: "center", paddingRight: 12 },
  });
}
