import { useRef, useState } from "react";
import { Animated, View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, dropShadow, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { NATIVE_DRIVER } from "../lib/animations";

const VISIBLE_MS = 3200;

// Small congratulatory banner slid in from the top when the episode just
// marked watched turns out to be the last one of an Ended show — same
// slide-in/fade-out shape as the global badge-unlock toast (see
// context/BadgeUnlockContext.tsx), but a local hook+component pair instead
// of an app-wide context, since which show it's about is whatever screen
// triggered it (episode detail, or the Watch List's own checkmark — see
// app/episode/[id].tsx and app/(tabs)/index.tsx).
export function useFinaleToast() {
  const [visible, setVisible] = useState(false);
  const [showName, setShowName] = useState("");
  const translateY = useRef(new Animated.Value(-80)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show(name: string) {
    if (timer.current) clearTimeout(timer.current);
    setShowName(name);
    setVisible(true);
    translateY.setValue(-80);
    Animated.spring(translateY, { toValue: 0, useNativeDriver: NATIVE_DRIVER, speed: 14, bounciness: 8 }).start();
    timer.current = setTimeout(() => {
      Animated.timing(translateY, { toValue: -80, duration: 220, useNativeDriver: NATIVE_DRIVER }).start(() =>
        setVisible(false)
      );
    }, VISIBLE_MS);
  }

  return { visible, showName, translateY, show };
}

export function FinaleToast({ showName, translateY }: { showName: string; translateY: Animated.Value }) {
  const colors = useColors();
  const styles = useStyles(colors);
  const { t } = useLanguage();

  return (
    <Animated.View style={[styles.toast, { transform: [{ translateY }] }]} pointerEvents="none">
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name="ribbon" size={20} color={colors.badgeLast} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t.episodeDetail.finaleToastTitle}</Text>
          <Text style={styles.body} numberOfLines={2}>
            {t.episodeDetail.finaleToastBody(showName)}
          </Text>
        </View>
      </View>
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
      paddingHorizontal: 16,
      zIndex: 1000,
    },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      padding: 12,
      ...dropShadow({ opacity: 0.2, radius: 16, offsetY: 6, elevation: 8 }),
    },
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      backgroundColor: `${colors.badgeLast}22`,
      alignItems: "center",
      justifyContent: "center",
    },
    title: { fontSize: type.body, fontWeight: "800", color: colors.text },
    body: { fontSize: type.caption, color: colors.textMuted, marginTop: 1 },
  });
}
