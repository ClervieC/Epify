import { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors, radius, avatarSize, Colors } from "../lib/theme";
import { Avatar } from "./Avatar";

interface AvatarStackMember {
  name?: string;
  imageUri?: string | null;
}

interface AvatarStackProps {
  members: AvatarStackMember[];
  size?: "sm" | "md";
  max?: number;
  // The ring drawn around each avatar so overlapping circles read as
  // distinct people instead of a blob — needs to match whatever this sits
  // on (a white/dark card by default; pass the hero's own background for
  // anywhere else).
  ringColor?: string;
}

// Overlapping avatars — "who's in this room" at a glance, the familiar
// group-chat/shared-doc convention, instead of a bare "Members · 3" count.
// Used by both the Rooms list (app/rooms/index.tsx) and the room detail
// hero (app/rooms/[id].tsx).
export function AvatarStack({ members, size = "sm", max = 4, ringColor }: AvatarStackProps) {
  const colors = useColors();
  const boxSize = avatarSize[size];
  const overlap = Math.round(boxSize * 0.35);
  const ring = ringColor ?? colors.surface;
  const styles = useMemo(() => createStyles(boxSize, ring), [boxSize, ring]);
  const visible = members.slice(0, max);
  const overflow = members.length - visible.length;

  return (
    <View style={styles.row}>
      {visible.map((m, i) => (
        <View key={i} style={[styles.item, i > 0 && { marginLeft: -overlap }]}>
          <Avatar name={m.name} imageUri={m.imageUri} size={size} />
        </View>
      ))}
      {overflow > 0 && (
        <View style={[styles.item, styles.overflow, { marginLeft: -overlap, backgroundColor: colors.pillBg }]}>
          <Text style={[styles.overflowText, { color: colors.textMuted }]}>+{overflow}</Text>
        </View>
      )}
    </View>
  );
}

function createStyles(boxSize: number, ringColor: string) {
  return StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center" },
    item: {
      borderRadius: radius.pill,
      borderWidth: 2,
      borderColor: ringColor,
    },
    overflow: {
      width: boxSize,
      height: boxSize,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    overflowText: { fontSize: boxSize * 0.32, fontWeight: "800" },
  });
}
