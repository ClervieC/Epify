import { ReactNode, useRef, useState } from "react";
import { View, ScrollView, Pressable, StyleSheet, Platform, StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// Netflix-style hover arrows for any horizontally-scrolling row of cards —
// shared by app/(tabs)/explore.tsx's discover categories and
// app/(tabs)/profile.tsx's Favorites/Shows/Movies/Paused/Dropped/custom-list
// rows, which both used to hand-roll their own near-identical copy of this.
// Desktop web only: touch devices already scroll these rows fine with a
// swipe, and react-native-web fires a synthetic onMouseEnter on tap that
// would otherwise pin the arrows on-screen after the very first touch on
// mobile web — matchMedia's hover/pointer features are the actual "has a
// real mouse" signal, not Platform.OS alone.
export function HorizontalScrollRow({
  children,
  contentContainerStyle,
}: {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [hovered, setHovered] = useState(false);
  const canHover =
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const scrollX = useRef(0);
  const containerWidth = useRef(0);
  const contentWidth = useRef(0);

  function updateArrows() {
    setCanScrollLeft(scrollX.current > 4);
    setCanScrollRight(scrollX.current + containerWidth.current < contentWidth.current - 4);
  }

  function scrollBy(direction: 1 | -1) {
    // ~85% of the visible row per click — enough to feel like real progress
    // without jumping so far the user loses track of what they just saw
    // (mirrors Netflix's own per-click scroll distance).
    const amount = containerWidth.current * 0.85 || 400;
    scrollRef.current?.scrollTo({ x: Math.max(0, scrollX.current + direction * amount), animated: true });
  }

  const scroll = (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={contentContainerStyle}
      {...(Platform.OS === "web"
        ? {
            onScroll: (e: any) => {
              scrollX.current = e.nativeEvent.contentOffset.x;
              updateArrows();
            },
            onContentSizeChange: (w: number) => {
              contentWidth.current = w;
              updateArrows();
            },
            scrollEventThrottle: 16,
          }
        : {})}
    >
      {children}
    </ScrollView>
  );

  if (!canHover) return scroll;

  return (
    <View
      style={styles.wrap}
      onLayout={(e) => {
        containerWidth.current = e.nativeEvent.layout.width;
        updateArrows();
      }}
      // RN Web only — no touch/native equivalent for hover, and RN's own
      // View props don't declare these (react-native-web still forwards
      // them to the underlying DOM element at runtime).
      {...({ onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) } as any)}
    >
      {scroll}
      {hovered && canScrollLeft && (
        <Pressable
          style={[styles.arrow, styles.arrowLeft]}
          onPress={() => scrollBy(-1)}
          accessibilityRole="button"
          accessibilityLabel="Scroll left"
        >
          <Ionicons name="chevron-back" size={20} color="#fff" />
        </Pressable>
      )}
      {hovered && canScrollRight && (
        <Pressable
          style={[styles.arrow, styles.arrowRight]}
          onPress={() => scrollBy(1)}
          accessibilityRole="button"
          accessibilityLabel="Scroll right"
        >
          <Ionicons name="chevron-forward" size={20} color="#fff" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", justifyContent: "center" },
  arrow: {
    position: "absolute",
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    width: 32,
    height: 32,
    marginTop: "auto",
    marginBottom: "auto",
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  arrowLeft: { left: 8 },
  arrowRight: { right: 8 },
});
