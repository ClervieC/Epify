import { cloneElement, isValidElement, useRef, useState, ReactElement } from "react";
import { View, Text, StyleSheet, Platform, Dimensions } from "react-native";
import { useColors, radius, type } from "../lib/theme";

interface TooltipProps {
  label: string;
  // A single Pressable — cloned to receive onHoverIn/onHoverOut rather than
  // wrapped in a second touchable layer, which would sit on top of (and
  // steal hover/press events from) the one already there.
  children: ReactElement;
  // "below" (default): drops the bubble under the trigger, horizontally
  // centered/edge-aware — right for a lone icon button with open space
  // beneath it. "above": same horizontal behavior, flipped vertically — for
  // a trigger sitting at the very bottom of a page's content (episode
  // detail's "Watched by" row), where "below" has nothing but the viewport
  // edge/next content to open into and gets clipped or overlaps what comes
  // after. "left": bubble sits to the trigger's left, vertically centered
  // instead — for a dense vertical list (show detail's episode rows, one
  // avatar stack per row with only ~36px between them) where "below" lands
  // squarely on the next row's own content instead of empty space.
  placement?: "below" | "above" | "left";
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
export function Tooltip({ label, children, placement = "below" }: TooltipProps) {
  const [hovered, setHovered] = useState(false);
  const [align, setAlign] = useState<Align>("center");
  const wrapRef = useRef<View>(null);
  const colors = useColors();

  if (Platform.OS !== "web" || !isValidElement(children)) return children;

  function handleHoverIn() {
    // Edge-aware centering only matters for "below"/"above" — "left" always
    // anchors to the trigger's own left edge, nothing to measure.
    if (placement === "below" || placement === "above") {
      // measureInWindow gives the button's actual on-screen position, so
      // this adapts to wherever it's rendered rather than assuming a fixed
      // layout — the same Tooltip wraps a report button that's the last
      // item in a corner on one screen and one of several in a row on
      // another.
      wrapRef.current?.measureInWindow((x, _y, width) => {
        const windowWidth = Dimensions.get("window").width;
        if (windowWidth - (x + width) < EDGE_MARGIN) setAlign("right");
        else if (x < EDGE_MARGIN) setAlign("left");
        else setAlign("center");
      });
    }
    setHovered(true);
  }

  return (
    <View ref={wrapRef} style={styles.wrap}>
      {cloneElement(children as ReactElement<any>, {
        onHoverIn: handleHoverIn,
        onHoverOut: () => setHovered(false),
      })}
      {hovered && (
        <View
          pointerEvents="none"
          style={
            placement === "left"
              ? styles.bubbleLeftWrap
              : [placement === "above" ? styles.bubbleRowAbove : styles.bubbleRow, ALIGN_STYLES[align]]
          }
        >
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
  bubbleRowAbove: {
    position: "absolute",
    bottom: "100%",
    left: 0,
    right: 0,
    marginBottom: 6,
    zIndex: 50,
  },
  bubbleLeftWrap: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: "100%",
    marginRight: 6,
    alignItems: "flex-end",
    justifyContent: "center",
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
