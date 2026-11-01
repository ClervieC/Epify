import { ReactNode, useEffect, useRef, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "../lib/theme";
import { SWIPE_DISMISS_NATIVE_ID } from "../lib/swipeDismiss";

// How far (after damping) the finger has to pull before letting go reloads.
const THRESHOLD = 70;
const MAX_PULL = 110;
const DAMPING = 0.5;

// App-wide pull-to-refresh, web only. Launched from the Home Screen (iOS
// standalone), the app has no browser chrome and so no reload button at
// all, and react-native-web's RefreshControl is a no-op — so instead of
// wiring a RefreshControl into each of ~30 screens (which still wouldn't
// work here), one listener at the root reloads the page when you pull down
// from the top of whatever is scrolled. Every screen reads its caches first
// and revalidates on load, so a reload brings back fresh data everywhere.
//
// "At the top" is checked on the actual scroll container under the finger
// (walking up from the touch target), not the window — body never scrolls
// here (overflow: hidden in public/index.html), every screen scrolls inside
// its own ScrollView/FlatList div. Skipped entirely for touches that:
// - start outside #root (Sheets portal into document.body — see
//   components/Sheet.tsx — and have their own drag-down-to-close),
// - start on a swipe-down-to-dismiss hero (show/episode/movie detail, see
//   SWIPE_DISMISS_NATIVE_ID), where pulling down already means "close",
// - start in anything scrolled away from its top.
export function PullToRefresh({ children }: { children: ReactNode }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [pull, setPull] = useState(0);
  const [reloading, setReloading] = useState(false);
  const pullRef = useRef(0);

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    // null = not decided yet, false = this touch isn't a pull-to-refresh.
    let tracking: boolean | null = null;

    function eligibleStart(target: EventTarget | null): boolean {
      const root = document.getElementById("root");
      if (!(target instanceof Element) || !root || !root.contains(target)) return false;
      if (target.closest(`#${SWIPE_DISMISS_NATIVE_ID}`)) return false;
      for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
        const style = getComputedStyle(el);
        const scrollsY = style.overflowY === "auto" || style.overflowY === "scroll";
        if (scrollsY && el.scrollHeight > el.clientHeight && el.scrollTop > 0) return false;
      }
      return true;
    }

    function setPullValue(v: number) {
      pullRef.current = v;
      setPull(v);
    }

    function onStart(e: TouchEvent) {
      if (e.touches.length !== 1) {
        tracking = false;
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = eligibleStart(e.target) ? null : false;
    }

    function onMove(e: TouchEvent) {
      if (tracking === false) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (tracking === null) {
        // Wait for a clear direction before committing either way — a
        // horizontal swipe (carousels, swipe-to-mark-watched rows) or an
        // upward scroll is never a pull.
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        tracking = dy > 0 && Math.abs(dy) > Math.abs(dx);
        if (!tracking) return;
      }
      setPullValue(Math.min(MAX_PULL, Math.max(0, dy * DAMPING)));
    }

    function onEnd() {
      if (tracking && pullRef.current >= THRESHOLD) {
        setReloading(true);
        window.location.reload();
        return;
      }
      tracking = false;
      if (pullRef.current !== 0) setPullValue(0);
    }

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const visible = pull > 0 || reloading;
  const progress = reloading ? 1 : Math.min(1, pull / THRESHOLD);

  return (
    <View style={{ flex: 1 }}>
      {children}
      {visible && (
        <View
          pointerEvents="none"
          style={[
            styles.indicator,
            {
              top: insets.top + (reloading ? THRESHOLD : pull) - 36,
              opacity: progress,
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          {reloading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons
              name="arrow-down"
              size={18}
              color={progress >= 1 ? colors.accent : colors.textMuted}
              style={{ transform: [{ rotate: progress >= 1 ? "180deg" : "0deg" }] }}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  indicator: {
    position: "absolute",
    alignSelf: "center",
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
});
