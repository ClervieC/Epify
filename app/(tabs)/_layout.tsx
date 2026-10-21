import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tabs, useFocusEffect } from "expo-router";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AdBanner } from "../../components/AdBanner";
import { useColors, Colors } from "../../lib/theme";
import { useLanguage, Translations } from "../../lib/i18n";
import { useNotifications } from "../../context/NotificationsContext";
import { useActivityUnseen } from "../../context/ActivityContext";
import { fetchMyProfile } from "../../lib/profiles";
import { fetchOpenReportCount } from "../../lib/reports";
import { fetchSupportNeedsResponseCount } from "../../lib/support";

interface TabBarProps {
  state: { routes: { key: string; name: string }[]; index: number };
  navigation: any;
  unreadCount: number;
  hasUnseenActivity: boolean;
  hasAdminAlerts: boolean;
}

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: "tv-outline",
  movies: "film-outline",
  explore: "search-outline",
  activity: "pulse-outline",
  profile: "person-outline",
};

function tabLabels(t: Translations): Record<string, string> {
  return {
    index: t.tabs.shows,
    movies: t.tabs.movies,
    explore: t.tabs.explore,
    activity: t.tabs.activity,
    profile: t.tabs.profile,
  };
}

// TEMPORARY — same diagnostic technique that found the 5.2.3 double-padding
// bug (real device measurements beat guessing blind again): the user
// confirmed the gap below the tab bar on their iPhone behaves like the
// pre-5.2.3 bug (the app's own rendered area stops short of the real
// screen bottom), which reappeared after 5.2.4 added insets.top padding
// elsewhere on this same screen. Remove once the real root cause is found.
function DebugOverlay({ barBottom }: { barBottom: number | null }) {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<Record<string, string>>({});

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const vv = window.visualViewport;
    const rootEl = document.getElementById("root");
    const rootRect = rootEl?.getBoundingClientRect();
    setData({
      innerHeight: String(window.innerHeight),
      vvHeight: vv ? String(vv.height) : "n/a",
      vvOffsetTop: vv ? String(vv.offsetTop) : "n/a",
      screenHeight: String(window.screen.height),
      dpr: String(window.devicePixelRatio),
      standalone: String((navigator as any).standalone),
      rootTop: rootRect ? String(rootRect.top) : "n/a",
      rootBottom: rootRect ? String(rootRect.bottom) : "n/a",
      rootHeight: rootRect ? String(rootRect.height) : "n/a",
      barBottom: barBottom != null ? String(barBottom) : "n/a",
      insetsTop: String(insets.top),
      insetsBottom: String(insets.bottom),
    });
  }, [barBottom, insets.top, insets.bottom]);

  return (
    <View style={debugStyles.box} pointerEvents="none">
      {Object.entries(data).map(([k, v]) => (
        <Text key={k} style={debugStyles.text}>
          {k}: {v}
        </Text>
      ))}
    </View>
  );
}

const debugStyles = StyleSheet.create({
  box: {
    position: "absolute",
    top: 60,
    left: 8,
    right: 8,
    backgroundColor: "rgba(200,0,0,0.9)",
    padding: 8,
    borderRadius: 6,
    zIndex: 9999,
  },
  text: { color: "#fff", fontSize: 10, fontFamily: Platform.OS === "web" ? "monospace" : undefined },
});

function CustomTabBar({ state, navigation, unreadCount, hasUnseenActivity, hasAdminAlerts }: TabBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const labels = tabLabels(t);
  const barRef = useRef<View>(null);
  const [barBottom, setBarBottom] = useState<number | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = barRef.current as unknown as HTMLElement | null;
    if (node?.getBoundingClientRect) {
      setBarBottom(node.getBoundingClientRect().bottom);
    }
  }, []);

  return (
    <View>
      <DebugOverlay barBottom={barBottom} />
      <AdBanner />
      {/* paddingBottom is the LARGER of 20 (room for the tap targets, the
          original fixed value on any screen with no home-indicator inset to
          worry about) and the inset itself — NOT the sum of both. Summing
          them (an earlier version of this fix) double-counted: a standard
          iOS tab bar's own clearance below its labels already *is* the
          home-indicator inset, not that inset stacked on top of its own
          separate padding, and stacking both measured out to a visibly
          oversized blank strip below the bar on a real phone (confirmed
          live via a temporary on-screen diagnostic overlay: #root's own
          rendered height exactly matched the screen, so the page itself
          was never the wrong size — this padding was just larger than it
          needed to be). insets.bottom is 0 anywhere a home indicator isn't
          in play (web tab, Android, older iPhones), where this is just 20,
          unchanged from before. */}
      <View ref={barRef} style={[styles.bar, { paddingBottom: Math.max(20, insets.bottom) }]}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const color = focused ? colors.accent : colors.textFaint;

          return (
            <Pressable
              key={route.key}
              style={styles.item}
              accessibilityRole="tab"
              accessibilityLabel={labels[route.name]}
              accessibilityState={{ selected: focused }}
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
                {route.name === "profile" && (unreadCount > 0 || hasAdminAlerts) && <View style={styles.badge} />}
                {route.name === "activity" && hasUnseenActivity && <View style={styles.badge} />}
              </View>
              <Text style={[styles.label, { color }]}>{labels[route.name]}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const MIN_REFETCH_INTERVAL_MS = 10_000;

export default function TabsLayout() {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const { unreadCount, refresh } = useNotifications();
  const { hasUnseen: hasUnseenActivity, refresh: refreshActivity } = useActivityUnseen();
  const [hasAdminAlerts, setHasAdminAlerts] = useState(false);
  const lastFetchedAt = useRef(0);

  // Only admins ever see this (fetchMyProfile()'s own is_admin check gates
  // it before either count query fires), so this stays a single cheap
  // is_admin lookup for every other user. Combines open reports and open
  // support messages (see app/admin/index.tsx's two queues) into one badge —
  // this is "something needs your attention," not two separate signals.
  const refreshAdminAlerts = useCallback(() => {
    fetchMyProfile().then((profile) => {
      if (!profile?.is_admin) {
        setHasAdminAlerts(false);
        return;
      }
      Promise.all([fetchOpenReportCount(), fetchSupportNeedsResponseCount()])
        .then(([reports, support]) => setHasAdminAlerts(reports > 0 || support > 0))
        .catch(() => {});
    });
  }, []);

  // (tabs) is one Stack.Screen among several siblings (episode/[id], show/[id],
  // users/*, connections/[id], notifications — see app/_layout.tsx),
  // so this refires on return from ANY of those, not just notifications, and
  // NOT on switching between this group's own tabs (index/movies/explore/profile
  // — that's a child-navigator change, not a focus change on this screen).
  // The min-interval guard avoids a Supabase round trip on every quick
  // in-and-out navigation (e.g. opening and closing an episode modal). This
  // only needs to catch NEW notifications that arrived elsewhere — clearing
  // the badge after the user actually reads them is handled instantly by
  // NotificationsContext's markAllRead(), not by this poll.
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastFetchedAt.current < MIN_REFETCH_INTERVAL_MS) return;
      lastFetchedAt.current = now;
      refresh();
      refreshActivity();
      refreshAdminAlerts();
    }, [refresh, refreshActivity, refreshAdminAlerts])
  );

  return (
    <Tabs
      // None of the 5 tab screens use useSafeAreaInsets for their own top
      // padding — each just has a small fixed paddingTop (10-24px) tuned
      // for when the OS reserved the status bar area outside the page
      // entirely. viewport-fit=cover (public/index.html) now extends the
      // page's own rendering behind the status bar/Dynamic Island on iOS
      // standalone, same root cause as the tab bar's own bottom padding
      // fix above — except here nothing was compensating at all, so a
      // screen's title/avatar/content rendered straight under the status
      // bar instead of below it (found live: Profile's username and email
      // sitting behind the time/battery icons). sceneStyle wraps every tab
      // screen's content in one shared container, so this one `insets.top`
      // fixes all 5 without touching each screen's own layout — their
      // existing small paddingTop stays underneath it as the original
      // "a bit of breathing room" margin, now measured from below the
      // status bar instead of from the physical top edge.
      screenOptions={{ headerShown: false, sceneStyle: { paddingTop: insets.top } }}
      tabBar={(props) => (
        <CustomTabBar
          {...(props as any)}
          unreadCount={unreadCount}
          hasUnseenActivity={hasUnseenActivity}
          hasAdminAlerts={hasAdminAlerts}
        />
      )}
    >
      <Tabs.Screen name="index" options={{ title: t.tabs.shows }} />
      <Tabs.Screen name="movies" options={{ title: t.tabs.movies }} />
      <Tabs.Screen name="explore" options={{ title: t.tabs.explore }} />
      <Tabs.Screen name="activity" options={{ title: t.tabs.activity }} />
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
