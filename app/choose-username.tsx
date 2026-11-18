import { useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { createProfile, clearMyProfileCache, USERNAME_REGEX } from "../lib/profiles";
import { useAuth } from "../context/AuthContext";

// For a signed-in account with no profiles row (see needsUsername in
// context/AuthContext.tsx). Signup normally creates the row along with the
// account (handle_new_user in supabase/schema.sql), so this is the fallback:
// accounts from before that trigger, or whose username got taken in the
// split second between the form's check and the insert. Without a row the
// account can't be searched, followed or seen in the admin list, so
// app/_layout.tsx shows this right after the intro and keeps the rest of the
// app behind it until it's done.
export default function ChooseUsernameScreen() {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const { setNeedsUsername } = useAuth();
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = username.trim();
    if (!USERNAME_REGEX.test(trimmed)) {
      setError(t.signup.usernameInvalid);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await createProfile(trimmed);
      clearMyProfileCache();
      // app/_layout.tsx's redirect effect moves on from here (onboarding
      // or the tabs) as soon as this flips.
      setNeedsUsername(false);
    } catch {
      setError(t.signup.usernameTaken);
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={[`${colors.accent}26`, "transparent"]} style={[styles.glow, { pointerEvents: "none" }]} />
      <View style={styles.content}>
        <Ionicons name="at-outline" size={40} color={colors.accent} style={{ marginBottom: 20 }} />
        <Text style={styles.title}>{t.chooseUsername.title}</Text>
        <Text style={styles.body}>{t.chooseUsername.body}</Text>
        <TextInput
          style={styles.input}
          placeholder={t.signup.username}
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          maxLength={20}
          returnKeyType="done"
          value={username}
          onChangeText={setUsername}
          onSubmitEditing={save}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable
          style={[styles.saveBtn, { opacity: saving || !username.trim() ? 0.6 : 1 }]}
          onPress={save}
          disabled={saving || !username.trim()}
          accessibilityRole="button"
        >
          {saving ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={styles.saveText}>{t.chooseUsername.save}</Text>
          )}
        </Pressable>
        <Pressable onPress={() => supabase.auth.signOut()} accessibilityRole="button">
          <Text style={styles.signOut}>{t.chooseUsername.signOut}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    glow: { position: "absolute", top: 0, left: 0, right: 0, height: 320 },
    content: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 28,
      paddingBottom: 44,
    },
    title: {
      fontSize: type.display,
      fontWeight: "800",
      color: colors.text,
      textAlign: "center",
      marginBottom: 12,
    },
    body: {
      fontSize: type.body,
      color: colors.textMuted,
      textAlign: "center",
      lineHeight: 22,
      maxWidth: 300,
      marginBottom: 28,
    },
    input: {
      backgroundColor: colors.surface,
      color: colors.text,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      fontSize: 16,
      width: "100%",
      maxWidth: 400,
    },
    error: {
      color: colors.red,
      fontSize: type.bodySm,
      marginTop: 10,
      textAlign: "center",
    },
    saveBtn: {
      width: "100%",
      maxWidth: 400,
      borderRadius: radius.pill,
      paddingVertical: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accent,
      marginTop: 20,
    },
    saveText: { color: colors.onAccent, fontWeight: "800", fontSize: type.body },
    signOut: { color: colors.textMuted, fontSize: type.bodySm, marginTop: 20, padding: 8 },
  });
}
