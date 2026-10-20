import { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors, radius, hueForTitle, Colors } from "../lib/theme";

interface RoomBadgeProps {
  name: string;
  emoji: string | null;
  size?: number;
}

// A room's visual identity — its chosen emoji (see ROOM_EMOJIS in lib/
// rooms.ts) on a colored circle, or the name's first letter when no emoji
// was picked, mirroring how components/Avatar.tsx falls back to an initial
// when there's no photo. The color itself reuses hueForTitle (lib/theme.tsx,
// already used for posterless movie cards) rather than inventing a second
// deterministic-color scheme — same trick, same existing palette.
export function RoomBadge({ name, emoji, size = 40 }: RoomBadgeProps) {
  const colors = useColors();
  const hue = hueForTitle(name);
  const styles = useMemo(() => createStyles(colors, size), [colors, size]);

  return (
    <View style={[styles.circle, { backgroundColor: colors[hue] }]}>
      {emoji ? (
        <Text style={styles.emoji}>{emoji}</Text>
      ) : (
        <Text style={styles.initial}>{name[0]?.toUpperCase() ?? "?"}</Text>
      )}
    </View>
  );
}

function createStyles(colors: Colors, size: number) {
  return StyleSheet.create({
    circle: {
      width: size,
      height: size,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    emoji: { fontSize: size * 0.55 },
    initial: { fontSize: size * 0.45, fontWeight: "800", color: colors.onAccent },
  });
}
