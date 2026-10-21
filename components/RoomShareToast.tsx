import { useRef, useState } from "react";
import { Animated, View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, dropShadow, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { NATIVE_DRIVER } from "../lib/animations";

const VISIBLE_MS = 2600;

// Shown right after a "share with room" action completes. The FeelingSheet
// popup that hosts RoomSharePicker closes itself immediately on share (see
// e.g. app/(tabs)/index.tsx's handleShareRoom, which calls feelingPrompt.
// close() before the share even finishes) — so RoomSharePicker's own
// success state never gets a chance to render, and a tap on "Share" looked
// like it did nothing. That's exactly why it was easy to end up sharing the
// same episode several times. This toast lives on the parent screen
// instead, which is still mounted once the sheet is gone. Same slide-in/
// fade-out shape as FinaleToast (a local hook+component pair per screen,
// not a global context, since which screen it's shown from varies).
export function useRoomShareToast() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const translateY = useRef(new Animated.Value(-80)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show(roomNames: string[]) {
    if (roomNames.length === 0) return;
    if (timer.current) clearTimeout(timer.current);
    setMessage(roomNames.join(", "));
    setVisible(true);
    translateY.setValue(-80);
    Animated.spring(translateY, { toValue: 0, useNativeDriver: NATIVE_DRIVER, speed: 14, bounciness: 8 }).start();
    timer.current = setTimeout(() => {
      Animated.timing(translateY, { toValue: -80, duration: 220, useNativeDriver: NATIVE_DRIVER }).start(() =>
        setVisible(false)
      );
    }, VISIBLE_MS);
  }

  return { visible, message, translateY, show };
}

export function RoomShareToast({ message, translateY }: { message: string; translateY: Animated.Value }) {
  const colors = useColors();
  const styles = useStyles(colors);
  const { t } = useLanguage();

  return (
    <Animated.View style={[styles.toast, { transform: [{ translateY }] }]} pointerEvents="none">
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t.rooms.sharedToastTitle}</Text>
          <Text style={styles.body} numberOfLines={2}>
            {message}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

function useStyles(colors: Colors) {
  return StyleSheet.create({
    toast: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      paddingTop: 50,
      paddingHorizontal: 16,
      zIndex: 1000,
    },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      padding: 12,
      ...dropShadow({ opacity: 0.2, radius: 16, offsetY: 6, elevation: 8 }),
    },
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      backgroundColor: `${colors.accent}22`,
      alignItems: "center",
      justifyContent: "center",
    },
    title: { fontSize: type.body, fontWeight: "800", color: colors.text },
    body: { fontSize: type.caption, color: colors.textMuted, marginTop: 1 },
  });
}
