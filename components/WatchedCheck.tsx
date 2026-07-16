import { useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, GestureResponderEvent, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors, Colors } from "../lib/theme";
import { useRewatchPrompt } from "../context/RewatchPromptContext";
import { NATIVE_DRIVER } from "../lib/animations";

interface WatchedCheckProps {
  watched: boolean;
  timesWatched?: number;
  onToggle: () => void;
  onRewatch?: () => void;
  // "I didn't actually watch it again, I misclicked" — only offered (as a
  // third dialog option alongside unwatch/rewatch) once timesWatched > 1,
  // since undoing from 1 down to 0 is exactly what onToggle already does.
  onUndoRewatch?: () => void;
  size?: number;
  light?: boolean;
  // For a not-yet-released movie: nothing to mark watched yet. Only meant to
  // block the unwatched->watched transition — always leave this false/unset
  // once `watched` is true, so unwatching (or rewatching) stays possible
  // regardless of release status.
  disabled?: boolean;
}

export function WatchedCheck({
  watched,
  timesWatched,
  onToggle,
  onRewatch,
  onUndoRewatch,
  size = 30,
  light,
  disabled,
}: WatchedCheckProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const askRewatch = useRewatchPrompt();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  function bounce() {
    // Slowed down from the original 80ms/tension:200 — that read as a single
    // flicker, too fast to actually register as "this just got marked
    // watched." Lower tension + higher friction stretches the settle out
    // without looking sluggish.
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.7, duration: 150, useNativeDriver: NATIVE_DRIVER }),
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 80, useNativeDriver: NATIVE_DRIVER }),
    ]).start();
  }

  const rewatched = watched && (timesWatched ?? 1) > 1;

  async function handlePress(e: GestureResponderEvent) {
    e.stopPropagation();
    if (disabled) return;
    if (!watched) {
      bounce();
      onToggle();
      return;
    }
    const choice = await askRewatch(rewatched && !!onUndoRewatch);
    if (choice === "cancel") return;
    bounce();
    if (choice === "rewatch") {
      onRewatch?.();
    } else if (choice === "undoRewatch") {
      onUndoRewatch?.();
    } else {
      onToggle();
    }
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={watched ? "Mark as not watched" : "Mark as watched"}
      accessibilityState={{ disabled }}
    >
      <Animated.View
        style={[
          styles.check,
          { width: size, height: size, borderRadius: size / 2, transform: [{ scale }] },
          watched && (light ? styles.checkOnLight : styles.checkOn),
          disabled && styles.checkDisabled,
        ]}
      >
        {rewatched ? (
          <Text style={[styles.timesText, { fontSize: size * 0.42 }]}>×{timesWatched}</Text>
        ) : (
          <Ionicons name="checkmark" size={size * 0.53} color={watched ? "#fff" : colors.textFaint} />
        )}
      </Animated.View>
    </Pressable>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    check: {
      backgroundColor: colors.pillBg,
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "center",
    },
    checkOn: { backgroundColor: colors.green },
    checkOnLight: { backgroundColor: colors.green },
    checkDisabled: { opacity: 0.4 },
    timesText: { color: "#fff", fontWeight: "800" },
  });
}
