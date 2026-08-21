import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, dropShadow, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { NATIVE_DRIVER } from "../lib/animations";
import { APP_VERSION } from "../lib/changelog";
import { getLastSeenChangelogVersion, setLastSeenChangelogVersion } from "../lib/lastSeenVersion";

const VISIBLE_MS = 3200;

// Self-triggered on mount rather than by an external event (unlike
// FinaleToast) — "a new version exists" is discovered once by comparing
// APP_VERSION against what this device last saw, not in response to
// something the user just did. Lives on the Shows tab (see
// app/(tabs)/index.tsx), which stays mounted for the app session, so this
// only fires once per real app open.
export function NewVersionToast() {
  const router = useRouter();
  const colors = useColors();
  const styles = useStyles(colors);
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);
  const translateY = useRef(new Animated.Value(-80)).current;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    getLastSeenChangelogVersion().then((seen) => {
      if (cancelled || seen === APP_VERSION) return;
      setLastSeenChangelogVersion(APP_VERSION);
      setVisible(true);
      Animated.spring(translateY, { toValue: 0, useNativeDriver: NATIVE_DRIVER, speed: 14, bounciness: 8 }).start();
      timer = setTimeout(() => {
        Animated.timing(translateY, { toValue: -80, duration: 220, useNativeDriver: NATIVE_DRIVER }).start(() =>
          setVisible(false)
        );
      }, VISIBLE_MS);
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.toast, { transform: [{ translateY }] }]}>
      <Pressable style={styles.card} onPress={() => router.push("/whatsnew")}>
        <Ionicons name="sparkles" size={16} color={colors.accent} />
        <Text style={styles.text} numberOfLines={1}>
          {t.shows.newVersionToast(APP_VERSION)}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function useStyles(colors: Colors) {
  return StyleSheet.create({
    toast: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      paddingTop: 50,
      alignItems: "center",
      zIndex: 1000,
    },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.pill,
      paddingVertical: 8,
      paddingHorizontal: 14,
      ...dropShadow({ opacity: 0.2, radius: 16, offsetY: 6, elevation: 8 }),
    },
    text: { fontSize: type.caption, fontWeight: "700", color: colors.text },
  });
}
