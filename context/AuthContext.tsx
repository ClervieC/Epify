import { createContext, useContext, useEffect, useState, PropsWithChildren } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { fetchMyProfile, createProfile } from "../lib/profiles";
import { consumePendingUsername } from "../lib/pendingUsername";
import { clearWatchingSnapshot } from "../lib/watchingSnapshot";
import { clearAllShowDataCaches } from "../lib/showDataCache";
import { resetPrefetchState } from "../lib/backgroundPrefetch";
import { clearLocalShowStats } from "../lib/showStats";
import { clearProfileSnapshot } from "../lib/profileSnapshot";

// None of these caches' storage keys are scoped by user id (see each
// module's own comment) — without clearing them here, signing into a
// different account on the same device would briefly (or, if the fresh
// fetch is slow/fails, not-so-briefly) show the previous account's shows,
// watched status, etc. straight from disk.
function clearUserScopedCaches() {
  clearWatchingSnapshot();
  clearAllShowDataCaches();
  resetPrefetchState();
  clearLocalShowStats();
  clearProfileSnapshot();
}

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  // True once the post-login initial data (e.g. the Shows tab's tracked
  // shows) has loaded at least once — lets the root splash screen stay up
  // until there's actually something to show, not just until the session
  // check resolves. Reset to false on sign-out so the next login shows the
  // splash again instead of reusing a stale "ready" flag.
  dataReady: boolean;
  setDataReady: (ready: boolean) => void;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
  dataReady: false,
  setDataReady: () => {},
});

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataReady, setDataReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession) {
        setDataReady(false);
        clearUserScopedCaches();
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // Finishes provisioning the profile row for an account that signed up
  // needing email confirmation (see app/(auth)/signup.tsx and
  // lib/pendingUsername.ts) — signUp() had no session yet to attach the
  // typed username to at that point, so it was stashed locally instead.
  // First real session on this device (confirming the email, then logging
  // in) is what completes it; a no-op for every other login since there's
  // nothing pending by then.
  useEffect(() => {
    if (!session) return;
    let active = true;
    (async () => {
      const pendingUsername = await consumePendingUsername();
      if (!pendingUsername || !active) return;
      const existing = await fetchMyProfile();
      if (existing) return;
      await createProfile(pendingUsername).catch(() => {});
    })();
    return () => {
      active = false;
    };
  }, [session]);

  return (
    <AuthContext.Provider value={{ session, loading, dataReady, setDataReady }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
