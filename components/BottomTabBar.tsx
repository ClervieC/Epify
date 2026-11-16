import { useMemo, useSyncExternalStore } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors, Colors } from "../lib/theme";
import { useLanguage, Translations } from "../lib/i18n";

export const TAB_NAMES = ["index", "movies", "explore", "activity", "profile"] as const;
export type TabName = (typeof TAB_NAMES)[number];

const ICONS: Record<TabName, keyof typeof Ionicons.glyphMap> = {
  index: "tv-outline",
  movies: "film-outline",
  explore: "search-outline",
  activity: "pulse-outline",
  profile: "person-outline",
};

function tabLabels(t: Translations): Record<TabName, string> {
  return {
    index: t.tabs.shows,
    movies: t.tabs.movies,
    explore: t.tabs.explore,
    activity: t.tabs.activity,
    profile: t.tabs.profile,
  };
}

// The last tab the (tabs) navigator showed — the bar rendered over every
// other screen (see GlobalTabBar in app/_layout.tsx) highlights it, so a
// show opened from Explore still reads as "in Explore".
let lastTab: TabName = "index";
export function setLastTab(name: TabName) {
  lastTab = name;
}
export function getLastTab(): TabName {
  return lastTab;
}

// Admin "something needs your attention" dot on Profile — computed by
// app/(tabs)/_layout.tsx, read by both bars.
let adminAlerts = false;
const adminAlertListeners = new Set<() => void>();
export function setAdminAlerts(value: boolean) {
  if (value === adminAlerts) return;
  adminAlerts = value;
  adminAlertListeners.forEach((l) => l());
}
export function useAdminAlerts(): boolean {
  return useSyncExternalStore(
    (l) => {
      adminAlertListeners.add(l);
      return () => adminAlertListeners.delete(l);
    },
    () => adminAlerts,
  );
}

interface BottomTabBarProps {
  active: TabName | null;
  onPress: (name: TabName) => void;
  unreadCount: number;
  hasUnseenActivity: boolean;
  hasAdminAlerts: boolean;
}

// The bar itself, shared by the (tabs) navigator's own tabBar and the copy
// shown under every screen pushed on top of it — same look either way.
export function BottomTabBar({ active, onPress, unreadCount, hasUnseenActivity, hasAdminAlerts }: BottomTabBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const labels = tabLabels(t);

  return (
    // paddingBottom is the LARGER of 20 (room for the tap targets) and the
    // home-indicator inset — not their sum, which left an oversized blank
    // strip under the bar on a real phone.
    <View style={[styles.bar, { paddingBottom: Math.max(20, insets.bottom) }]}>
      {TAB_NAMES.map((name) => {
        const focused = active === name;
        const color = focused ? colors.accent : colors.textFaint;
        return (
          <Pressable
            key={name}
            style={styles.item}
            accessibilityRole="tab"
            accessibilityLabel={labels[name]}
            accessibilityState={{ selected: focused }}
            onPress={() => onPress(name)}
          >
            <View>
              <Ionicons name={ICONS[name]} size={22} color={color} />
              {name === "profile" && (unreadCount > 0 || hasAdminAlerts) && <View style={styles.badge} />}
              {name === "activity" && hasUnseenActivity && <View style={styles.badge} />}
            </View>
            <Text style={[styles.label, { color }]}>{labels[name]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    bar: {
      flexDirection: "row",
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 8,
    },
    item: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    label: {
      fontSize: 11,
      fontWeight: "600",
    },
    badge: {
      position: "absolute",
      top: -2,
      right: -4,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.red,
    },
  });
}
