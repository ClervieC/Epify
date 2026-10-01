import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, dropShadow, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { NATIVE_DRIVER } from "../lib/animations";
import { lastViewableMonth, recapMonthKey } from "../lib/recap";
import { getLastSeenRecapMonth, setLastSeenRecapMonth } from "../lib/lastSeenRecapMonth";

const VISIBLE_MS = 3200;
// Pushed below where NewVersionToast sits (its own paddingTop: 50) rather
// than sharing that exact spot — the two are independent, unrelated
// triggers (a new app version vs. a new month rolling over) that could in
// principle both fire on the same first-open-of-the-month, and stacking
// them is simpler than coordinating a shared queue for what should be a
// rare coincidence.
const TOP_OFFSET = 104;

// Same self-triggered-on-mount shape as NewVersionToast (see its own
// comment) — "a new month's recap is ready" is discovered once by comparing
// the last fully-ended month against what this device last saw, not in
// response to something the user just did. Lives on the Shows tab (see
// app/(tabs)/index.tsx), same as NewVersionToast, so it only fires once per
// real app open regardless of which tab the recap banner itself now lives
// on (Social — see app/(tabs)/activity.tsx).
export function NewMonthRecapToast() {
  const router = useRouter();
  const colors = useColors();
  const styles = useStyles(colors);
  const { t, language } = useLanguage();
  const [visible, setVisible] = useState(false);
  const translateY = useRef(new Animated.Value(-80)).current;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const month = lastViewableMonth(new Date());
    const monthKey = recapMonthKey(month);

    getLastSeenRecapMonth().then((seen) => {
      if (cancelled || seen === monthKey) return;
      setLastSeenRecapMonth(monthKey);
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

  const monthLabel = lastViewableMonth(new Date()).toLocaleDateString(language === "fr" ? "fr-FR" : "en-US", {
    month: "long",
  });

  return (
    <Animated.View style={[styles.toast, { transform: [{ translateY }] }]}>
      <Pressable
        style={styles.card}
        onPress={() => router.push({ pathname: "/recap", params: { mode: "month", back: "social" } })}
      >
        <Ionicons name="sparkles" size={16} color={colors.accent} />
        <Text style={styles.text} numberOfLines={1}>
          {t.recap.monthlyToast(monthLabel)}
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
      paddingTop: TOP_OFFSET,
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
