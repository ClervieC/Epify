import { ReactNode } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useColors, radius, Colors } from "../lib/theme";

interface UserRowProps {
  username: string;
  onPress: () => void;
  trailing?: ReactNode;
}

export function UserRow({ username, onPress, trailing }: UserRowProps) {
  const colors = useColors();
  const styles = createStyles(colors);

  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.avatar}>
        <Text style={styles.avatarInitial}>{username[0]?.toUpperCase()}</Text>
      </View>
      <Text style={styles.username} numberOfLines={1}>
        {username}
      </Text>
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
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarInitial: { fontSize: 16, fontWeight: "800", color: colors.onAccent },
    username: { flex: 1, fontWeight: "700", fontSize: 14, color: colors.text },
  });
}
