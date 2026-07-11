import { createContext, useCallback, useContext, useEffect, useState, PropsWithChildren } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "./AuthContext";
import { fetchLatestFollowingActivityAt } from "../lib/activity";

const LAST_SEEN_KEY = "activity_last_seen_at";

interface ActivityContextValue {
  hasUnseen: boolean;
  refresh: () => void;
  // Optional latestKnownAt lets a caller that just fetched the feed itself
  // (see app/(tabs)/activity.tsx) pass the real newest timestamp straight
  // through, rather than relying on this context's own `latestAt` — which is
  // only ever refreshed by the Stack-level focus effect in
  // app/(tabs)/_layout.tsx, not by switching to the Activity tab itself (a
  // child-navigator tab change isn't a Stack focus event), and is throttled
  // to once per 10s on top of that. Without the override, marking seen could
  // persist a stale "latest" from before the activity that's actually on
  // screen, leaving the tab bar dot stuck on even after the user looked.
  markSeen: (latestKnownAt?: string) => void;
}

const ActivityContext = createContext<ActivityContextValue>({
  hasUnseen: false,
  refresh: () => {},
  markSeen: () => {},
});

// The activity feed (lib/activity.ts) has no "read" flag of its own — it's
// assembled on the fly from four unrelated tables, not a single log with a
// row to mark read. So "seen" is tracked client-side instead: the timestamp
// of the most recent item across everyone you follow, compared against the
// last time you actually opened the Activity tab (persisted locally, so it
// survives an app restart). Mirrors NotificationsContext's shared-state
// pattern for the same reason: without a single source of truth, the tab bar
// dot and the Activity screen's own focus effect could disagree about
// whether there's something new.
export function ActivityProvider({ children }: PropsWithChildren) {
  const { session } = useAuth();
  const [hasUnseen, setHasUnseen] = useState(false);
  const [latestAt, setLatestAt] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchLatestFollowingActivityAt()
      .then(async (latest) => {
        setLatestAt(latest);
        if (!latest) {
          setHasUnseen(false);
          return;
        }
        const lastSeen = await AsyncStorage.getItem(LAST_SEEN_KEY);
        setHasUnseen(!lastSeen || new Date(latest) > new Date(lastSeen));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!session) {
      setHasUnseen(false);
      setLatestAt(null);
      return;
    }
    refresh();
  }, [session, refresh]);

  const markSeen = useCallback((latestKnownAt?: string) => {
    setHasUnseen(false);
    const stamp = latestKnownAt ?? latestAt ?? new Date().toISOString();
    AsyncStorage.setItem(LAST_SEEN_KEY, stamp).catch(() => {});
  }, [latestAt]);

  return (
    <ActivityContext.Provider value={{ hasUnseen, refresh, markSeen }}>{children}</ActivityContext.Provider>
  );
}

export function useActivityUnseen() {
  return useContext(ActivityContext);
}
