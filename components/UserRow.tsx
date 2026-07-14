import { ReactNode } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useColors, type, Colors } from "../lib/theme";
import { Avatar } from "./Avatar";

interface UserRowProps {
  username: string;
  imageUri?: string | null;
  subtitle?: string;
  // For callers with more than one independent stat to show (e.g. a shows
  // match and a movies match) — kept as separate lines rather than joined
  // into `subtitle` with a separator, so each stays its own truncatable
  // line instead of one long string that clips the second stat first.
  // Ignored if `subtitle` is also passed.
  subtitleLines?: string[];
  onPress: () => void;
  trailing?: ReactNode;
}

export function UserRow({ username, imageUri, subtitle, subtitleLines, onPress, trailing }: UserRowProps) {
  const colors = useColors();
  const styles = createStyles(colors);

  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Avatar name={username} imageUri={imageUri} size="sm" />
      <View style={{ flex: 1 }}>
        <Text style={styles.username} numberOfLines={1}>
          {username}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : (
          subtitleLines?.map((line, i) => (
            <Text key={i} style={styles.subtitle} numberOfLines={1}>
              {line}
            </Text>
          ))
        )}
      </View>
      {trailing}
    </Pressable>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    username: { fontWeight: "700", fontSize: type.body, color: colors.text },
    subtitle: { fontSize: type.caption, color: colors.textMuted, marginTop: 1 },
  });
}
