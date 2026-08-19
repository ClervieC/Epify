import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, iconSize, Colors } from "../lib/theme";

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  // Optional call-to-action button (e.g. "Explore shows" -> /explore) —
  // an empty list is a dead end without one; the caller owns navigation via
  // onAction so this component stays screen-agnostic. Mirrors the button
  // app/(tabs)/activity.tsx already hand-builds next to its own EmptyState
  // (findPeopleBtn) — same style, now available to every other screen too.
  actionLabel?: string;
  onAction?: () => void;
}

// One "nothing here yet" layout for every screen — icon, title, optional
// subtitle, optional action button. Doesn't set flex:1 itself; wrap it if
// you want it to fill the screen (most lists just want it centered where
// the content would be).
export function EmptyState({ icon, title, subtitle, actionLabel, onAction }: EmptyStateProps) {
  const colors = useColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={iconSize.lg} color={colors.accentDark} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {actionLabel && onAction && (
        <Pressable style={styles.actionBtn} onPress={onAction}>
          <Text style={styles.actionBtnText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 32, paddingHorizontal: 24 },
    iconWrap: {
      width: 56,
      height: 56,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 4,
    },
    title: { fontSize: type.bodySm, fontWeight: "700", color: colors.text, textAlign: "center" },
    subtitle: { fontSize: type.caption, color: colors.textMuted, textAlign: "center" },
    actionBtn: {
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
      paddingVertical: 10,
      paddingHorizontal: 20,
      marginTop: 10,
    },
    actionBtnText: { color: colors.onAccent, fontWeight: "700" },
  });
}
