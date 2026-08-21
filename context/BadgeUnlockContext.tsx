import { createContext, useCallback, useContext, useEffect, useRef, useState, PropsWithChildren } from "react";
import { Animated, View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Badge, badgeIcon, categoryColor, badgeLabel } from "../lib/streaks";
import { setBadgeUnlockListener, setAlmostUnlockedListener } from "../lib/badgeNotify";
import { useColors, radius, type, dropShadow, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { NATIVE_DRIVER } from "../lib/animations";

interface QueuedBadge {
  badge: Badge;
  kind: "unlocked" | "almost";
}

interface BadgeUnlockContextValue {
  announceBadges: (badges: Badge[]) => void;
}

const BadgeUnlockContext = createContext<BadgeUnlockContextValue | null>(null);

const VISIBLE_MS = 3200;

// Mounted once at the app root so a badge earned while on any screen (Shows,
// an episode detail, wherever computeStreakData() happens to run — see its
// onNewlyUnlocked param) shows the same top banner regardless of which
// screen is currently active, rather than each call site having to know how
// to render one. Queues rather than overlapping when several badges unlock
// in the same compute (e.g. crossing two thresholds in one watch session).
// Also shows a visually distinct "almost there" toast (see
// getNewlyAlmostUnlocked in lib/streaks.ts) for a badge exactly one
// watch/rating/follow away — same queue, same animations, different copy.
export function BadgeUnlockProvider({ children }: PropsWithChildren) {
  const colors = useColors();
  const styles = useStyles(colors);
  const { t } = useLanguage();
  const router = useRouter();
  const [queue, setQueue] = useState<QueuedBadge[]>([]);
  const current = queue[0] ?? null;
  const translateY = useRef(new Animated.Value(-80)).current;
  const scale = useRef(new Animated.Value(0.7)).current;
  const iconRotate = useRef(new Animated.Value(0)).current;
  const iconPulse = useRef(new Animated.Value(1)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  const announceBadges = useCallback((badges: Badge[]) => {
    if (badges.length === 0) return;
    setQueue((prev) => [...prev, ...badges.map((badge) => ({ badge, kind: "unlocked" as const }))]);
  }, []);

  const announceAlmostBadges = useCallback((badges: Badge[]) => {
    if (badges.length === 0) return;
    setQueue((prev) => [...prev, ...badges.map((badge) => ({ badge, kind: "almost" as const }))]);
  }, []);

  // Registers this provider's announce functions as the targets for
  // lib/badgeNotify.ts's checkBadgesNow() — the trigger fired right after a
  // watch/rate/rewatch mutation (see lib/userShows.ts, lib/userMovies.ts) so
  // a badge earned (or almost-earned) from the Movies tab or a show/episode
  // detail screen shows the same toast immediately, not just next time
  // Shows/Profile/Streaks happens to recompute.
  useEffect(() => {
    setBadgeUnlockListener(announceBadges);
    setAlmostUnlockedListener(announceAlmostBadges);
    return () => {
      setBadgeUnlockListener(null);
      setAlmostUnlockedListener(null);
    };
  }, [announceBadges, announceAlmostBadges]);

  function dismiss() {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    pulseLoop.current?.stop();
    Animated.parallel([
      Animated.timing(translateY, { toValue: -80, duration: 220, useNativeDriver: NATIVE_DRIVER }),
      Animated.timing(scale, { toValue: 0.85, duration: 220, useNativeDriver: NATIVE_DRIVER }),
    ]).start(() => {
      setQueue((prev) => prev.slice(1));
    });
  }

  useEffect(() => {
    if (!current) return;
    translateY.setValue(-80);
    scale.setValue(0.7);
    iconRotate.setValue(0);
    // A snappier, more overshoot-y pop than a plain slide-down — this is
    // meant to feel like a real reward moment, not just another banner.
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: NATIVE_DRIVER, speed: 14, bounciness: 10 }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: NATIVE_DRIVER, speed: 14, bounciness: 18 }),
    ]).start(() => {
      // One-shot icon wiggle once the card has landed, then a slow breathing
      // pulse for as long as the toast stays up.
      Animated.sequence([
        Animated.timing(iconRotate, { toValue: 1, duration: 110, useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(iconRotate, { toValue: -1, duration: 160, useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(iconRotate, { toValue: 0, duration: 110, useNativeDriver: NATIVE_DRIVER }),
      ]).start();
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(iconPulse, { toValue: 1.12, duration: 420, useNativeDriver: NATIVE_DRIVER }),
          Animated.timing(iconPulse, { toValue: 1, duration: 420, useNativeDriver: NATIVE_DRIVER }),
        ])
      );
      pulseLoop.current.start();
    });
    dismissTimer.current = setTimeout(dismiss, VISIBLE_MS);
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      pulseLoop.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.badge.id]);

  const color = current ? categoryColor(colors, current.badge.category) : colors.accent;
  const iconSpin = iconRotate.interpolate({ inputRange: [-1, 0, 1], outputRange: ["-18deg", "0deg", "18deg"] });

  return (
    <BadgeUnlockContext.Provider value={{ announceBadges }}>
      {children}
      {current && (
        <Animated.View
          style={[styles.banner, { transform: [{ translateY }, { scale }] }]}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={() => {
              dismiss();
              router.push("/streaks");
            }}
            style={[styles.cardBase, { backgroundColor: colors.surface }]}
          >
            <LinearGradient
              colors={[`${color}59`, `${color}22`]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.card, { borderColor: `${color}88` }]}
            >
              <Animated.View
                style={[
                  styles.iconWrap,
                  { backgroundColor: `${color}2a`, transform: [{ rotate: iconSpin }, { scale: iconPulse }] },
                ]}
              >
                <Ionicons name={badgeIcon(current.badge)} size={22} color={color} />
              </Animated.View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>
                  {current.kind === "unlocked" ? "🎉" : "⏳"}{" "}
                  {current.kind === "unlocked" ? t.profile.badgeUnlockedTitle : t.profile.almostUnlockedTitle}
                </Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  {badgeLabel(t, current.badge)}
                </Text>
              </View>
              <Pressable onPress={dismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel={t.common.cancel}>
                <Ionicons name="close" size={18} color={colors.textFaint} />
              </Pressable>
            </LinearGradient>
          </Pressable>
        </Animated.View>
      )}
    </BadgeUnlockContext.Provider>
  );
}

export function useBadgeUnlockToast() {
  const ctx = useContext(BadgeUnlockContext);
  if (!ctx) throw new Error("useBadgeUnlockToast must be used within BadgeUnlockProvider");
  return ctx.announceBadges;
}

function useStyles(colors: Colors) {
  return StyleSheet.create({
    banner: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      paddingTop: 50,
      paddingHorizontal: 16,
      zIndex: 1000,
    },
    cardBase: {
      borderRadius: radius.lg,
      ...dropShadow({ opacity: 0.25, radius: 18, offsetY: 6, elevation: 8 }),
    },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: 12,
    },
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    title: { fontSize: type.caption, fontWeight: "800", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
    subtitle: { fontSize: type.body, fontWeight: "800", color: colors.text, marginTop: 2 },
  });
}
