import { useEffect, useRef } from "react";
import { Animated } from "react-native";

export function useScalePress(toValue = 0.95) {
  const scale = useRef(new Animated.Value(1)).current;

  function onPressIn() {
    Animated.spring(scale, { toValue, useNativeDriver: true, speed: 50, bounciness: 6 }).start();
  }

  function onPressOut() {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 6 }).start();
  }

  return { scale, onPressIn, onPressOut };
}

export function useFadeIn(ready: boolean) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!ready) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, [ready, opacity]);

  return opacity;
}

export function useMountIn() {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 280, useNativeDriver: true }).start();
  }, [progress]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  return { opacity: progress, transform: [{ translateY }] };
}

// Quick color flash overlay, meant to confirm an action (e.g. marking an
// episode watched) happened right away. Imperatively triggered rather than
// derived from state, so it fires the instant the user acts — it doesn't
// depend on the row still showing the same data (or even still being
// mounted at the same list position) once a network round-trip resolves.
export function useFlashPulse() {
  const opacity = useRef(new Animated.Value(0)).current;

  function flash() {
    opacity.setValue(0.35);
    Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }).start();
  }

  return { opacity, flash };
}

export function useGrowIn(trigger: unknown) {
  const scaleX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    scaleX.setValue(0);
    Animated.timing(scaleX, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  return scaleX;
}
