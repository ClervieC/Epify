import { useMemo } from "react";
import { View, Text, Pressable, Animated, StyleSheet } from "react-native";
import { useColors, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { useScalePress } from "../lib/animations";
import { FEELING_EMOJIS } from "../lib/feelings";
import { ShareableRoom } from "../lib/rooms";
import { Sheet } from "./Sheet";
import { RoomSharePicker } from "./RoomSharePicker";

interface FeelingSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (key: string) => void;
  // Non-empty only when the viewer is in at least one room — see
  // lib/useWatchedFeelingPrompt.ts, which is also what decides `visible`
  // itself: showFeelingPrompt=false alone no longer hides this sheet if
  // rooms is non-empty, since the room-share block below has nothing to do
  // with the feeling-reaction setting.
  rooms?: ShareableRoom[];
  onShareRoom?: (roomIds: string[], userIds: string[]) => void | Promise<void>;
}

// Quick-capture popup shown right after marking an episode watched from a
// list row (Watch List, Upcoming) — a lighter touch than navigating to the
// episode's own page just to log how it felt. Tapping outside (Sheet's
// backdrop) dismisses without saving, same as picking nothing.
export function FeelingSheet({ visible, onClose, onSelect, rooms, onShareRoom }: FeelingSheetProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t, showFeelingPrompt } = useLanguage();

  return (
    <Sheet visible={visible} onClose={onClose}>
      {showFeelingPrompt && (
        <>
          <Text style={styles.title}>{t.episodeDetail.howDidYouFeel}</Text>
          <View style={styles.row}>
            {FEELING_EMOJIS.map((f) => (
              <FeelingButton key={f.key} emoji={f.emoji} label={t.feelings[f.key]} onPress={() => onSelect(f.key)} styles={styles} />
            ))}
          </View>
        </>
      )}
      {rooms && rooms.length > 0 && onShareRoom && (
        <View style={showFeelingPrompt ? styles.roomBlock : undefined}>
          <RoomSharePicker rooms={rooms} onShare={onShareRoom} />
        </View>
      )}
    </Sheet>
  );
}

type Styles = ReturnType<typeof createStyles>;

function FeelingButton({
  emoji,
  label,
  onPress,
  styles,
}: {
  emoji: string;
  label: string;
  onPress: () => void;
  styles: Styles;
}) {
  const { scale, onPressIn, onPressOut } = useScalePress(0.88);

  return (
    <Pressable onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress} style={styles.chip}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Text style={styles.emoji}>{emoji}</Text>
      </Animated.View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    title: {
      textAlign: "center",
      fontWeight: "800",
      fontSize: 13,
      color: colors.textMuted,
      letterSpacing: 0.5,
      marginBottom: 16,
    },
    row: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 4 },
    chip: { alignItems: "center", gap: 4, padding: 8 },
    emoji: { fontSize: 32 },
    label: { fontSize: type.micro, fontWeight: "700", color: colors.textMuted },
    roomBlock: {
      marginTop: 16,
      paddingTop: 16,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
  });
}
