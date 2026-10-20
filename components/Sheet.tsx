import { ReactNode, useMemo } from "react";
import { createPortal } from "react-dom";
import { Animated, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors, radius, dropShadow, Colors } from "../lib/theme";
import { useSheetTransition } from "../lib/animations";

const WIDE_BREAKPOINT = 700;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

// The one bottom-sheet/dialog chrome in the app — a menu, a list picker,
// anything that's "a card of options over a backdrop." On mobile it's a
// sheet glued to the bottom edge (slides up + backdrop fades in); on a wide
// (tablet/desktop web) viewport that reads as an unadapted mobile pattern,
// so it becomes a centered dialog that scales in instead. Content is up to
// the caller.
export function Sheet({ visible, onClose, children }: SheetProps) {
  const { width, height } = useWindowDimensions();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isWide = width >= WIDE_BREAKPOINT;
  const { mounted, progress } = useSheetTransition(visible);

  if (!mounted) return null;

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });

  const content = (
    <AnimatedPressable
      style={[styles.backdrop, isWide && styles.backdropWide, { opacity: progress }]}
      onPress={onClose}
    >
      <Animated.View
        style={[
          styles.sheet,
          // The home indicator (and similar bottom insets) sits right under
          // this sheet's flush-to-the-edge padding — on a tall sheet (many
          // chips wrapping to 2-3 rows, e.g. FeelingSheet's 11 options) the
          // last row ended up grazing/behind it. Pushing the sheet up by
          // the inset keeps its content clear of that area instead of
          // relying on the fixed paddingBottom to be enough.
          // 32 mirrors styles.sheet's own paddingBottom — read as a literal,
          // not off the StyleSheet object, since StyleSheet.create returns
          // an opaque id (not a plain object) on native.
          !isWide && { paddingBottom: 32 + insets.bottom },
          isWide && styles.sheetWide,
          // A cap, not a fixed height — short content still only takes the
          // room it needs (ScrollView below doesn't force-fill this). Found
          // live: a FeelingSheet with both the full emoji grid and a room-
          // share block (see components/FeelingSheet.tsx) pushed its own
          // "Share" button entirely off-screen with nothing to scroll it
          // into view — every Sheet caller gets this ceiling now instead of
          // each one having to notice and fix it individually.
          // overflow:hidden is what actually makes the cap bite on web — RNW
          // compiles this to real CSS flexbox, where a nested flex chain's
          // default min-height:auto lets a child grow past its ancestor's
          // max-height instead of triggering the ScrollView's own scroll,
          // unless something in the chain clips. Native Yoga doesn't share
          // this quirk, but setting it here costs nothing there either.
          { maxHeight: height * 0.85, overflow: "hidden" },
          { transform: [isWide ? { scale } : { translateY }] },
        ]}
      >
        <Pressable onPress={(e) => e.stopPropagation()} style={styles.scrollWrap}>
          <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
        </Pressable>
      </Animated.View>
    </AnimatedPressable>
  );

  // Web only: portal straight to document.body so this backdrop's
  // position:fixed escapes every ancestor's CSS containing block. A
  // transformed ancestor anywhere up the tree (any Animated.View mid-
  // animation, common throughout this app) otherwise traps "fixed"
  // elements inside its own box instead of the real viewport — found live
  // as a tall FeelingSheet (full emoji grid + a room-share block, see
  // components/FeelingSheet.tsx) rendering *behind* the persistent bottom
  // tab bar on a tab screen, with its lower buttons genuinely unclickable
  // despite this component's own zIndex:1000, because the tab bar is its
  // own separate DOM subtree the trapped backdrop could never out-stack.
  // Native has no DOM/portal concept the same way; RN's own overlay
  // rendering doesn't share this CSS-specific escape-hatch requirement.
  return Platform.OS === "web" ? createPortal(content, document.body) : content;
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    backdrop: {
      // "absolute" is relative to the nearest positioned ancestor — inside
      // a screen's scrolling content, that's the scroll container itself,
      // whose height is the full *scrollable content* height, not the
      // visible viewport. top/bottom:0 then stretched this backdrop to
      // cover the whole page (found live: 1393px tall on a 900px-tall
      // window), so "centered" meant centered in the whole page, not in
      // whatever's actually on screen — open this scrolled partway down and
      // the popup could land visually near the bottom of the viewport, or
      // off-screen, instead of centered in view. "fixed" pins it to the
      // actual browser viewport regardless of scroll position or which
      // container it's nested in; native ignores this distinction (RN has
      // no scrolling positioned-ancestor concept the same way), so it stays
      // "absolute" there.
      position: Platform.OS === "web" ? "fixed" : "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      // Darkened from 0.45 — the previous version read as barely-there
      // once the page behind it was fully visible/undimmed at the wrong
      // scroll position (see the position fix above); this is dark enough
      // to read clearly as "this is now behind a modal" on its own.
      backgroundColor: "rgba(0,0,0,0.6)",
      justifyContent: "flex-end",
      // Every View in this app defaults to position:relative (React Native
      // Web), so a z-index:auto backdrop has no special "always on top"
      // status — with no zIndex set at all, it only ever painted above the
      // rest of the screen by accident of DOM order (rendered after
      // whatever it's meant to cover). That broke as soon as a screen
      // rendered content *after* this component in the same scroll
      // container (see components/MovieDetailView.tsx, app/episode/
      // [id].tsx) — the later content won the paint order and covered the
      // sheet entirely. 1000 matches this app's other full-screen overlays
      // (FinaleToast, ChoiceDialog, NewVersionToast) so every modal built
      // on Sheet is robust regardless of where it happens to sit in its
      // screen's tree.
      zIndex: 1000,
    } as ViewStyle,
    backdropWide: { justifyContent: "center", alignItems: "center", padding: 24 },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: 16,
      paddingBottom: 32,
      gap: 4,
    },
    // flexShrink lets this actually shrink below its content's natural
    // size when the sheet's own maxHeight clamps it — minHeight:0 overrides
    // the web flexbox default (min-height:auto) that would otherwise block
    // that shrink and silently defeat the overflow:hidden above.
    scrollWrap: { flexShrink: 1, minHeight: 0 },
    sheetWide: {
      width: "100%",
      maxWidth: 420,
      borderRadius: radius.lg,
      paddingBottom: 16,
      ...dropShadow({ opacity: 0.25, radius: 24, offsetY: 8, elevation: 12 }),
    },
  });
}
