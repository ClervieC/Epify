import { Platform } from "react-native";
import { APP_VERSION } from "./changelog";

// Web-only: a native app doesn't have a "tab left open forever" problem the
// same way — an OTA/store update replaces the installed binary directly,
// it's never running stale JS from a page nobody reloaded. On web (this
// includes the "Add to Home Screen" PWA case — see public/index.html's own
// apple-mobile-web-app-capable comment — which tends to stay open far
// longer than an ordinary browser tab), the bundle a device loaded at open
// time keeps running indefinitely otherwise: nothing about an SPA re-checks
// "is this still the latest build" on its own once it's already loaded.
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

async function isStale(): Promise<boolean> {
  try {
    // cache: "no-store" — a normal fetch would happily serve this from the
    // browser's own HTTP cache, which defeats the entire point (checking
    // what's actually deployed right now, not what was deployed last time
    // this file was fetched). public/version.json is a tiny static file
    // kept in sync by hand at each release (see lib/changelog.ts).
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return false;
    const data = (await res.json()) as { version?: string };
    return !!data.version && data.version !== APP_VERSION;
  } catch {
    // Offline, or the deploy is mid-flight and briefly 404s — never force a
    // reload over an inconclusive check.
    return false;
  }
}

// Called once from app/_layout.tsx's mount effect. Checks on a timer AND
// right when the tab/PWA regains focus (visibilitychange) — the latter
// matters more in practice: a PWA left open in the background for days and
// then reopened should catch up immediately, not wait up to
// CHECK_INTERVAL_MS after being brought back to the foreground. Reloading
// only happens from one of these two triggers (not, say, mid-scroll for no
// reason), so in practice it lands at a natural "just switched back to this"
// boundary rather than interrupting something mid-action.
export function startVersionCheck(): void {
  if (Platform.OS !== "web") return;

  async function checkAndReload() {
    if (await isStale()) window.location.reload();
  }

  const interval = setInterval(checkAndReload, CHECK_INTERVAL_MS);
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") checkAndReload();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  // No cleanup returned — this runs once for the lifetime of the tab, called
  // from a mount effect on the app root that itself never unmounts during a
  // normal session (see app/_layout.tsx).
}
