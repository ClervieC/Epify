import { cloneElement, isValidElement, useRef, useState, ReactElement } from "react";
import { View, Text, StyleSheet, Platform, Dimensions } from "react-native";
import { useColors, radius, type } from "../lib/theme";

interface TooltipProps {
  label: string;
  // A single Pressable — cloned to receive onHoverIn/onHoverOut rather than
  // wrapped in a second touchable layer, which would sit on top of (and
  // steal hover/press events from) the one already there.
  children: ReactElement;
}

type Align = "center" | "left" | "right";

// Margin from the window edge inside which the bubble switches from
// centered to edge-aligned — found the hard way in testing: a report
// button sitting right in the top-right corner (see MovieDetailView.tsx)
// centered its bubble on the button itself, which pushed a good chunk of
// the label straight off-screen since there's no room to the button's
// right at all.
const EDGE_MARGIN = 100;

// Web-only hover label for an icon-only button (share, report, ...) whose
// purpose isn't obvious at a glance without a mouse user hovering to find
// out — the same explanation already reaches VoiceOver/TalkBack via the
// button's own accessibilityLabel, but that's silent for a sighted mouse
// user until they either guess or tap. No-ops everywhere except web: touch
// devices have no hover state to key off in the first place.
export function Tooltip({ label, children }: TooltipProps) {
  const [hovered, setHovered] = useState(false);
  const [align, setAlign] = useState<Align>("center");
  const wrapRef = useRef<View>(null);
  const colors = useColors();

  if (Platform.OS !== "web" || !isValidElement(children)) return children;

  function handleHoverIn() {
    // measureInWindow gives the button's actual on-screen position, so this
    // adapts to wherever it's rendered rather than assuming a fixed layout —
    // the same Tooltip wraps a report button that's the last item in a
    // corner on one screen and one of several in a row on another.
    wrapRef.current?.measureInWindow((x, _y, width) => {
      const windowWidth = Dimensions.get("window").width;
      if (windowWidth - (x + width) < EDGE_MARGIN) setAlign("right");
      else if (x < EDGE_MARGIN) setAlign("left");
      else setAlign("center");
    });
    setHovered(true);
  }

  return (
    <View ref={wrapRef} style={styles.wrap}>
      {cloneElement(children as ReactElement<any>, {
        onHoverIn: handleHoverIn,
        onHoverOut: () => setHovered(false),
      })}
      {hovered && (
        <View pointerEvents="none" style={[styles.bubbleRow, ALIGN_STYLES[align]]}>
          <View style={[styles.bubble, { backgroundColor: colors.text }]}>
            <Text style={[styles.bubbleText, { color: colors.background }]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const ALIGN_STYLES: Record<Align, { alignItems: "center" | "flex-start" | "flex-end" }> = {
  center: { alignItems: "center" },
  left: { alignItems: "flex-start" },
  right: { alignItems: "flex-end" },
};

const styles = StyleSheet.create({
  wrap: { position: "relative" },
  bubbleRow: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    marginTop: 6,
    zIndex: 50,
  },
  bubble: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    maxWidth: 180,
  },
  bubbleText: { fontSize: type.micro, fontWeight: "700" },
});
