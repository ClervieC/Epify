import { useCallback, useMemo, useState } from "react";
import { Tabs, useFocusEffect } from "expo-router";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors, Colors } from "../../lib/theme";
import { useLanguage, Translations } from "../../lib/i18n";
import { fetchUnreadNotificationCount } from "../../lib/notifications";

interface TabBarProps {
  state: { routes: { key: string; name: string }[]; index: number };
  navigation: any;
  unreadCount: number;
}

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: "tv-outline",
  movies: "film-outline",
  explore: "search-outline",
  profile: "person-outline",
};

function tabLabels(t: Translations): Record<string, string> {
  return {
    index: t.tabs.shows,
    movies: t.tabs.movies,
    explore: t.tabs.explore,
    profile: t.tabs.profile,
  };
}

function CustomTabBar({ state, navigation, unreadCount }: TabBarProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const labels = tabLabels(t);

  return (
    <View style={styles.bar}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const color = focused ? colors.accent : colors.textFaint;

        return (
          <Pressable
            key={route.key}
            style={styles.item}
            onPress={() => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              // Already on this tab — block the navigator's default action
              // entirely so it doesn't reset/refocus the screen (which was
              // re-triggering that screen's focus-effect data reload).
              if (focused) {
                event.preventDefault();
                return;
              }
              if (!event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            }}
          >
            <View>
              <Ionicons name={ICONS[route.name]} size={22} color={color} />
              {route.name === "profile" && unreadCount > 0 && <View style={styles.badge} />}
            </View>
            <Text style={[styles.label, { color }]}>{labels[route.name]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  const { t } = useLanguage();
  const [unreadCount, setUnreadCount] = useState(0);

  // Refetches whenever the whole (tabs) group regains focus — covers app
  // start, switching tabs, and coming back from the notifications screen
  // (a stack push outside the tab navigator, so it doesn't remount this).
  useFocusEffect(
    useCallback(() => {
      fetchUnreadNotificationCount().then(setUnreadCount);
    }, [])
  );

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <CustomTabBar {...(props as any)} unreadCount={unreadCount} />}
    >
      <Tabs.Screen name="index" options={{ title: t.tabs.shows }} />
      <Tabs.Screen name="movies" options={{ title: t.tabs.movies }} />
      <Tabs.Screen name="explore" options={{ title: t.tabs.explore }} />
      <Tabs.Screen name="profile" options={{ title: t.tabs.profile }} />
    </Tabs>
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
      paddingBottom: 10,
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
