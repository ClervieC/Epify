import { useCallback, useRef } from "react";
import { Tabs, useFocusEffect } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AdBanner } from "../../components/AdBanner";
import { BottomTabBar, TabName, setLastTab, setAdminAlerts, useAdminAlerts } from "../../components/BottomTabBar";
import { restoreTabStack } from "../../lib/tabHistory";
import { useLanguage } from "../../lib/i18n";
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

function CustomTabBar({ state, navigation, unreadCount, hasUnseenActivity, hasAdminAlerts }: TabBarProps) {
  const activeRoute = state.routes[state.index];
  setLastTab(activeRoute.name as TabName);

  return (
    <View>
      <AdBanner />
      <BottomTabBar
        active={activeRoute.name as TabName}
        unreadCount={unreadCount}
        hasUnseenActivity={hasUnseenActivity}
        hasAdminAlerts={hasAdminAlerts}
        onPress={(name) => {
          const route = state.routes.find((r) => r.name === name);
          if (!route) return;
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          // Already on this tab — block the navigator's default action
          // entirely so it doesn't reset/refocus the screen (which was
          // re-triggering that screen's focus-effect data reload).
          if (route.key === activeRoute.key) {
            event.preventDefault();
            return;
          }
          if (!event.defaultPrevented) {
            navigation.navigate(name);
            restoreTabStack(name);
          }
        }}
      />
    </View>
  );
}

const MIN_REFETCH_INTERVAL_MS = 10_000;

export default function TabsLayout() {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const { unreadCount, refresh } = useNotifications();
  const { hasUnseen: hasUnseenActivity, refresh: refreshActivity } = useActivityUnseen();
  const hasAdminAlerts = useAdminAlerts();
  const lastFetchedAt = useRef(0);

  // Only admins ever see this (fetchMyProfile()'s own is_admin check gates
  // it before either count query fires), so this stays a single cheap
  // is_admin lookup for every other user. Combines open reports and open
  // support messages (see app/admin/index.tsx's two queues) into one badge —
  // this is "something needs your attention," not two separate signals.
  const refreshAdminAlerts = useCallback(() => {
    fetchMyProfile().then((profile) => {
      if (!profile?.is_admin) {
        setAdminAlerts(false);
        return;
      }
      Promise.all([fetchOpenReportCount(), fetchSupportNeedsResponseCount()])
        .then(([reports, support]) => setAdminAlerts(reports > 0 || support > 0))
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
