import { createContext, useCallback, useContext, useEffect, useRef, useState, PropsWithChildren } from "react";
import { useAuth } from "./AuthContext";
import { fetchUnreadNotificationCount, markAllNotificationsRead } from "../lib/notifications";
import { checkStaleWatchlistReminders } from "../lib/staleWatchlist";

interface NotificationsContextValue {
  unreadCount: number;
  refresh: () => void;
  markAllRead: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue>({
  unreadCount: 0,
  refresh: () => {},
  markAllRead: () => {},
});

// Single shared unread count instead of the tab bar badge and the profile
// screen's bell badge each polling their own independent, throttled copy —
// that's what let them disagree: viewing notifications marked everything
// read in the database, but only whichever screen's own focus-effect
// happened to fire (and wasn't within its own throttle window) actually
// noticed. markAllRead() below sets the shared count to 0 immediately, so
// every consumer clears in the same instant, regardless of navigation
// timing.
export function NotificationsProvider({ children }: PropsWithChildren) {
  const { session } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  // Bumped by markAllRead() so a refresh() already in flight when the user
  // opens Notifications (e.g. app/(tabs)/_layout.tsx's focus-triggered poll,
  // fired just before markAllRead's own un-awaited write commits) can't
  // resolve afterward and silently resurrect a nonzero count over the
  // optimistic 0.
  const versionRef = useRef(0);

  const refresh = useCallback(() => {
    const myVersion = ++versionRef.current;
    fetchUnreadNotificationCount()
      .then((count) => versionRef.current === myVersion && setUnreadCount(count))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!session) {
      setUnreadCount(0);
      return;
    }
    // Runs once per session (login/app cold start), not on every focus —
    // plenty for a reminder that only ever fires once per show anyway (see
    // checkStaleWatchlistReminders' dedup). Always refresh() after, whether
    // or not it found anything new, so the badge reflects any inserted rows.
    checkStaleWatchlistReminders()
      .catch(() => {})
      .finally(refresh);
  }, [session, refresh]);

  const markAllRead = useCallback(() => {
    versionRef.current++;
    setUnreadCount(0);
    markAllNotificationsRead().catch(() => {});
  }, []);

  return (
    <NotificationsContext.Provider value={{ unreadCount, refresh, markAllRead }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
