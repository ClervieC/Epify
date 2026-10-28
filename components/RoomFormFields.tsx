import { useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { ROOM_EMOJIS } from "../lib/rooms";
import { searchShows, TVMazeShow } from "../lib/tvmaze";
import { Pill } from "./Pill";
import { Ionicons } from "@expo/vector-icons";

export type ExpiryChoice = "none" | "days";

// A show linked for "Currently watching" (see fetchLinkedShowProgress in
// lib/rooms.ts) — deliberately not the full TVMazeShow shape, since the edit
// form (app/rooms/[id].tsx) only ever has the already-fetched {id, name,
// imageUrl} from the room's existing linkedProgress, not a fresh search
// result, to prefill with.
export interface LinkedShowChoice {
  id: number;
  name: string;
  imageUrl: string | null;
}

interface RoomFormFieldsProps {
  name: string;
  onNameChange: (v: string) => void;
  emoji: string | null;
  onEmojiChange: (v: string | null) => void;
  expiryChoice: ExpiryChoice;
  onExpiryChoiceChange: (v: ExpiryChoice) => void;
  days: string;
  onDaysChange: (v: string) => void;
  showQuery: string;
  onShowQueryChange: (v: string) => void;
  selectedShow: LinkedShowChoice | null;
  onSelectShow: (show: LinkedShowChoice) => void;
  onClearShow: () => void;
}

// The room name/icon/expiry/linked-show fields — shared by the create-room
// sheet (app/rooms/index.tsx) and the edit-room sheet (app/rooms/[id].tsx)
// so the two forms can't drift apart. Search state (query + results) stays
// local to this component since neither caller needs to read it — only the
// resolved selectedShow matters to them.
export function RoomFormFields({
  name,
  onNameChange,
  emoji,
  onEmojiChange,
  expiryChoice,
  onExpiryChoiceChange,
  days,
  onDaysChange,
  showQuery,
  onShowQueryChange,
  selectedShow,
  onSelectShow,
  onClearShow,
}: RoomFormFieldsProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const [results, setResults] = useState<TVMazeShow[]>([]);

  return (
    <>
      <TextInput
        style={styles.nameInput}
        placeholder={t.rooms.roomNamePlaceholder}
        placeholderTextColor={colors.textFaint}
        value={name}
        onChangeText={onNameChange}
      />

      <Text style={styles.fieldLabel}>{t.rooms.emojiLabel}</Text>
      <View style={styles.emojiRow}>
        {ROOM_EMOJIS.map((e) => (
          <Pressable
            key={e}
            style={[styles.emojiOption, emoji === e && styles.emojiOptionSelected]}
            onPress={() => onEmojiChange(emoji === e ? null : e)}
            accessibilityRole="button"
            accessibilityState={{ selected: emoji === e }}
            accessibilityLabel={e}
          >
            <Text style={styles.emojiOptionText}>{e}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.fieldLabel}>{t.rooms.expiryLabel}</Text>
      <View style={styles.expiryRow}>
        <Pill size="sm" tone={expiryChoice === "none" ? "solid" : "neutral"} onPress={() => onExpiryChoiceChange("none")}>
          {t.rooms.expiryNone}
        </Pill>
        <Pill size="sm" tone={expiryChoice === "days" ? "solid" : "neutral"} onPress={() => onExpiryChoiceChange("days")}>
          {t.rooms.expiryDays}
        </Pill>
      </View>
      {expiryChoice === "days" && (
        <TextInput
          style={styles.nameInput}
          placeholder={t.rooms.expiryDaysPlaceholder}
          placeholderTextColor={colors.textFaint}
          value={days}
          onChangeText={onDaysChange}
          keyboardType="number-pad"
        />
      )}

      <Text style={styles.fieldLabel}>{t.rooms.linkShowLabel}</Text>
      {/* Search results are presentation-only state nobody outside this
          field needs to read, so they stay local here rather than joining
          the two screens' own form state. */}
      <TextInput
        style={styles.nameInput}
        placeholder={t.rooms.linkShowPlaceholder}
        textContentType="none"
        autoComplete="off"
        importantForAutofill="no"
        placeholderTextColor={colors.textFaint}
        value={showQuery}
        onChangeText={(text) => {
          onShowQueryChange(text);
          if (selectedShow) onClearShow();
          if (!text.trim()) {
            setResults([]);
            return;
          }
          searchShows(text.trim()).then((found) => setResults(found.map((r) => r.show)));
        }}
      />
      {selectedShow ? (
        <View style={styles.selectedShowRow}>
          {selectedShow.imageUrl && <Image source={{ uri: selectedShow.imageUrl }} style={styles.selectedShowImage} />}
          <Text style={styles.selectedShowName}>{selectedShow.name}</Text>
          <Pressable onPress={onClearShow} hitSlop={10} accessibilityRole="button" accessibilityLabel={t.rooms.linkShowClear}>
            <Ionicons name="close-circle" size={20} color={colors.textFaint} />
          </Pressable>
        </View>
      ) : (
        results.slice(0, 5).map((show) => (
          <Pressable
            key={show.id}
            style={styles.showResultRow}
            onPress={() => {
              onSelectShow({ id: show.id, name: show.name, imageUrl: show.image?.medium ?? null });
              setResults([]);
            }}
          >
            {show.image?.medium && <Image source={{ uri: show.image.medium }} style={styles.selectedShowImage} />}
            <Text style={styles.selectedShowName}>{show.name}</Text>
          </Pressable>
        ))
      )}
    </>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    nameInput: {
      backgroundColor: colors.backgroundAlt,
      borderRadius: radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: type.input,
      color: colors.text,
      marginBottom: 12,
    },
    fieldLabel: { fontWeight: "800", fontSize: type.caption, color: colors.textMuted, marginBottom: 8 },
    emojiRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
    emojiOption: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.backgroundAlt,
    },
    emojiOptionSelected: { backgroundColor: colors.accentSoft, borderWidth: 2, borderColor: colors.accent },
    emojiOptionText: { fontSize: 20 },
    expiryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
    selectedShowRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
    showResultRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
    selectedShowImage: { width: 32, height: 46, borderRadius: radius.sm, backgroundColor: colors.backgroundAlt },
    selectedShowName: { fontWeight: "700", fontSize: type.body, color: colors.text, flex: 1 },
  });
}
