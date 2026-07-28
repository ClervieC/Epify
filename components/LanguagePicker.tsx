import { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors, radius, type, dropShadow, Colors } from "../lib/theme";
import { useLanguage, Language } from "../lib/i18n";

const LANGUAGES: { code: Language; label: string }[] = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
];

// Only on the signed-out screens (login/signup) — everywhere else, language
// lives in Settings once there's an account/session to save the preference
// to (see lib/i18n.tsx's LanguageProvider). Before that, the device-locale
// default (see getDeviceLanguage) is usually right, but someone signing up
// on a shared/borrowed device needs a way to override it before they even
// have an account.
export function LanguagePicker() {
  const { language, setLanguage } = useLanguage();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState(false);

  return (
    <View style={[styles.wrap, { top: insets.top + 12 }]}>
      {open && (
        // Full-bleed invisible tap target behind the menu — position:
        // absolute here resolves against this component's own (relatively
        // positioned by default) wrap View, but that View's own top/right
        // placement still lets 0/0/0/0 stretch to cover the whole screen
        // since nothing else in between constrains it.
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
      )}
      <Pressable
        style={[styles.trigger, open && styles.triggerOpen]}
        onPress={() => setOpen((o) => !o)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Change language"
      >
        <Ionicons name="globe-outline" size={14} color={colors.textMuted} />
        <Text style={styles.triggerText}>{language.toUpperCase()}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={12} color={colors.textFaint} />
      </Pressable>
      {open && (
        <View style={styles.menu}>
          {LANGUAGES.map((l) => (
            <Pressable
              key={l.code}
              style={styles.menuItem}
              onPress={() => {
                setLanguage(l.code);
                setOpen(false);
              }}
            >
              <Text style={[styles.menuItemText, l.code === language && styles.menuItemTextActive]}>
                {l.label}
              </Text>
              {l.code === language && <Ionicons name="checkmark" size={14} color={colors.accent} />}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: { position: "absolute", right: 16, zIndex: 20 },
    backdrop: { position: "absolute", top: -1000, left: -1000, right: -1000, bottom: -1000 },
    trigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.pill,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    triggerOpen: { borderColor: colors.accent },
    triggerText: { fontSize: type.caption, fontWeight: "800", color: colors.text, letterSpacing: 0.5 },
    menu: {
      position: "absolute",
      top: 40,
      right: 0,
      minWidth: 140,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 4,
      ...dropShadow({ opacity: 0.18, radius: 16, offsetY: 6 }),
    },
    menuItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    menuItemText: { fontSize: type.bodySm, color: colors.textMuted, fontWeight: "600" },
    menuItemTextActive: { color: colors.text, fontWeight: "800" },
  });
}
