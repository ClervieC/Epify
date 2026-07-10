import { useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { Link } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useColors, radius, type, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";
import { createProfile } from "../../lib/profiles";
import { savePendingUsername } from "../../lib/pendingUsername";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const MIN_PASSWORD_LENGTH = 6;

export default function SignupScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  async function handleSignup() {
    setError(null);
    setInfo(null);

    if (!USERNAME_RE.test(username)) {
      setError(t.signup.usernameInvalid);
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t.signup.passwordTooShort);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }

    if (data.session) {
      try {
        await createProfile(username);
      } catch {
        setLoading(false);
        setError(t.signup.usernameTaken);
        return;
      }
    } else {
      // No session yet (email confirmation required) — nothing can create
      // the profile row until one exists. Stashed locally so AuthContext
      // finishes the job automatically on first login instead of asking
      // for the username again (see lib/pendingUsername.ts).
      await savePendingUsername(username);
    }

    setLoading(false);
    setInfo(t.signup.success);
  }

  return (
    <View style={styles.container}>
      <Image
        source={require("../../assets/logo.png")}
        style={styles.logo}
        contentFit="contain"
      />
      <Text style={styles.title}>{t.signup.title}</Text>

      <TextInput
        style={styles.input}
        placeholder={t.signup.email}
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        keyboardType="email-address"
        returnKeyType="next"
        value={email}
        onChangeText={setEmail}
        onSubmitEditing={() => usernameRef.current?.focus()}
      />
      <TextInput
        ref={usernameRef}
        style={styles.input}
        placeholder={t.signup.username}
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        returnKeyType="next"
        value={username}
        onChangeText={setUsername}
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <TextInput
        ref={passwordRef}
        style={styles.input}
        placeholder={t.signup.password}
        placeholderTextColor={colors.textFaint}
        secureTextEntry
        returnKeyType="go"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={handleSignup}
      />
      <Text style={styles.hint}>{t.signup.passwordHint}</Text>

      {error && <Text style={styles.error}>{error}</Text>}
      {info && <Text style={styles.info}>{info}</Text>}

      <Pressable
        style={styles.button}
        onPress={handleSignup}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={colors.onAccent} />
        ) : (
          <Text style={styles.buttonText}>{t.signup.signUp}</Text>
        )}
      </Pressable>

      <Link href="/(auth)/login" style={styles.link}>
        <Text style={styles.link}>
          {t.signup.hasAccountPrompt}{" "}
          <Text style={styles.linkAccent}>{t.login.signIn}</Text>
        </Text>
      </Link>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: "center",
      padding: 24,
      backgroundColor: colors.background,
    },
    logo: {
      width: 96,
      height: 96,
      alignSelf: "center",
      marginBottom: 12,
      borderRadius: radius.lg,
    },
    title: {
      fontSize: type.display,
      fontWeight: "800",
      color: colors.text,
      textAlign: "center",
      marginBottom: 32,
    },
    input: {
      backgroundColor: colors.surface,
      color: colors.text,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 12,
      fontSize: 16,
    },
    button: {
      backgroundColor: colors.accent,
      borderRadius: radius.sm,
      padding: 16,
      alignItems: "center",
      marginTop: 8,
    },
    buttonText: { color: colors.onAccent, fontWeight: "700", fontSize: 16 },
    hint: {
      color: colors.textFaint,
      fontSize: 12,
      marginTop: -8,
      marginBottom: 12,
    },
    error: { color: colors.red, marginBottom: 12, textAlign: "center" },
    info: { color: colors.green, marginBottom: 12, textAlign: "center" },
    link: {
      color: colors.textMuted,
      textAlign: "center",
      marginTop: 20,
      fontSize: 15,
    },
    linkAccent: { color: colors.accent, fontWeight: "700" },
  });
}
