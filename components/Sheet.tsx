import { ReactNode, useMemo } from "react";
import { Animated, Platform, Pressable, StyleSheet, useWindowDimensions, ViewStyle } from "react-native";
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
  const { width } = useWindowDimensions();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isWide = width >= WIDE_BREAKPOINT;
  const { mounted, progress } = useSheetTransition(visible);

  if (!mounted) return null;

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });

  return (
    <AnimatedPressable
      style={[styles.backdrop, isWide && styles.backdropWide, { opacity: progress }]}
      onPress={onClose}
    >
      <Animated.View
        style={[styles.sheet, isWide && styles.sheetWide, { transform: [isWide ? { scale } : { translateY }] }]}
      >
        <Pressable onPress={(e) => e.stopPropagation()}>{children}</Pressable>
      </Animated.View>
    </AnimatedPressable>
  );
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
    sheetWide: {
      width: "100%",
      maxWidth: 420,
      borderRadius: radius.lg,
      paddingBottom: 16,
      ...dropShadow({ opacity: 0.25, radius: 24, offsetY: 8, elevation: 12 }),
    },
  });
}
