import { ActivityIndicator, Pressable, Text, StyleSheet } from "react-native";
import { useColors, radius, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";

interface FollowButtonProps {
  following: boolean;
  onPress: () => void;
  loading?: boolean;
}

export function FollowButton({ following, onPress, loading }: FollowButtonProps) {
  const colors = useColors();
  const styles = createStyles(colors);
  const { t } = useLanguage();

  return (
    <Pressable
      style={[styles.button, following ? styles.buttonFollowing : styles.buttonFollow]}
      onPress={onPress}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color={following ? colors.text : colors.onAccent} />
      ) : (
        <Text style={[styles.text, following ? styles.textFollowing : styles.textFollow]}>
          {following ? t.social.following : t.social.follow}
        </Text>
      )}
    </Pressable>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    button: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: radius.pill,
      minWidth: 90,
      alignItems: "center",
    },
    buttonFollow: { backgroundColor: colors.accent },
    buttonFollowing: { backgroundColor: colors.pillBg },
    text: { fontSize: 13, fontWeight: "700" },
    textFollow: { color: colors.onAccent },
    textFollowing: { color: colors.text },
  });
}
