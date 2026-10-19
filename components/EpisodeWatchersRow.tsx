import { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, FlatList } from "react-native";
import { useRouter } from "expo-router";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { EpisodeWatcher } from "../lib/userShows";
import { Avatar } from "./Avatar";
import { UserRow } from "./UserRow";
import { Sheet } from "./Sheet";
import { Tooltip } from "./Tooltip";

const MAX_INLINE = 3;

interface EpisodeWatchersRowProps {
  watchers: EpisodeWatcher[];
}

// "Who among the people I follow has seen this episode" — only ever shows
// people the caller already follows (see fetchEpisodeWatchersAmongFollowing),
// never a stranger's watch history. Renders nothing if that list is empty,
// same as othersFelt right above it in app/episode/[id].tsx.
export function EpisodeWatchersRow({ watchers }: EpisodeWatchersRowProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  if (watchers.length === 0) return null;

  const inline = watchers.slice(0, MAX_INLINE);
  const extra = watchers.length - inline.length;

  return (
    <>
      <View style={styles.divider} />
      <Text style={styles.sectionLabel}>{t.episodeDetail.watchedBy}</Text>
      {/* A plain View, not one big Pressable — each avatar is its own
          Pressable now (see Tooltip's children requirement below), so this
          just lays them out overlapping. Every one of them still opens the
          same sheet on press. */}
      <View style={styles.stackRow}>
        {inline.map((w, i) => (
          <Tooltip key={w.user_id} label={w.username} placement="above">
            <Pressable
              style={[styles.stackItem, i > 0 && styles.stackOverlap]}
              onPress={() => setExpanded(true)}
              accessibilityRole="button"
              accessibilityLabel={w.username}
            >
              <Avatar name={w.username} imageUri={w.avatar_url} size="sm" />
            </Pressable>
          </Tooltip>
        ))}
        {extra > 0 && (
          <Pressable
            style={[styles.stackItem, styles.stackOverlap, styles.extraBadge]}
            onPress={() => setExpanded(true)}
            accessibilityRole="button"
            accessibilityLabel={t.episodeDetail.watchedBy}
          >
            <Text style={styles.extraBadgeText}>+{extra}</Text>
          </Pressable>
        )}
      </View>

      <Sheet visible={expanded} onClose={() => setExpanded(false)}>
        <Text style={styles.sheetTitle}>{t.episodeDetail.watchedBy}</Text>
        <FlatList
          data={watchers}
          keyExtractor={(w) => w.user_id}
          style={styles.sheetList}
          renderItem={({ item: w }) => (
            <UserRow
              username={w.username}
              imageUri={w.avatar_url}
              onPress={() => {
                setExpanded(false);
                router.push(`/users/${w.user_id}`);
              }}
            />
          )}
        />
      </Sheet>
    </>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 16 },
    sectionLabel: { fontWeight: "800", fontSize: type.caption, color: colors.textMuted, marginBottom: 10 },
    stackRow: { flexDirection: "row", alignSelf: "flex-start" },
    stackItem: {
      borderRadius: radius.pill,
      borderWidth: 2,
      borderColor: colors.background,
    },
    stackOverlap: { marginLeft: -12 },
    extraBadge: {
      width: 40,
      height: 40,
      backgroundColor: colors.backgroundAlt,
      alignItems: "center",
      justifyContent: "center",
    },
    extraBadgeText: { fontWeight: "800", fontSize: type.caption, color: colors.textMuted },
    sheetTitle: { textAlign: "center", fontWeight: "800", fontSize: 13, color: colors.textMuted, letterSpacing: 0.5, marginBottom: 8 },
    sheetList: { maxHeight: 360 },
  });
}
