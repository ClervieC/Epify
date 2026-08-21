import { useEffect, useMemo } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { useGoBack } from "../lib/useGoBack";
import { CHANGELOG, APP_VERSION } from "../lib/changelog";
import { setLastSeenChangelogVersion } from "../lib/lastSeenVersion";

export default function WhatsNewScreen() {
  const goBack = useGoBack("/settings");
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t, language } = useLanguage();

  // Marks the latest version "seen" the moment this screen opens, so the
  // dot in Settings (see app/settings.tsx) clears itself the same way an
  // unread badge would.
  useEffect(() => {
    setLastSeenChangelogVersion(APP_VERSION);
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t.profile.whatsNew}</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {CHANGELOG.map((entry, index) => (
          <View key={entry.version} style={styles.entry}>
            <View style={styles.entryHeader}>
              <Text style={styles.version}>
                {t.profile.whatsNewVersion(entry.version)}
                {index === 0 ? ` · ${t.profile.whatsNewLatest}` : ""}
              </Text>
              <Text style={styles.date}>{entry.date}</Text>
            </View>
            {(language === "fr" ? entry.fr : entry.en).map((item, i) => (
              <View key={i} style={styles.itemRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.itemText}>{item}</Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 12,
    },
    title: { fontSize: type.title, fontWeight: "800", color: colors.text },
    content: { paddingHorizontal: 20, paddingBottom: 40 },
    entry: {
      marginBottom: 22,
      paddingBottom: 22,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    entryHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 },
    version: { fontSize: type.subtitle, fontWeight: "800", color: colors.text },
    date: { fontSize: type.caption, color: colors.textMuted },
    itemRow: { flexDirection: "row", gap: 8, marginBottom: 6 },
    bullet: { fontSize: type.body, color: colors.accent, lineHeight: 21 },
    itemText: { flex: 1, fontSize: type.body, color: colors.textMuted, lineHeight: 21 },
  });
}
