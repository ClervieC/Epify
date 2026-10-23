import { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { fetchMySupportMessages, sendSupportMessage, SupportMessage } from "../lib/support";
import { shortDate } from "../lib/dates";
import { alert } from "../lib/alert";
import { Pill } from "../components/Pill";
import { useGoBack } from "../lib/useGoBack";
import { enterToSubmit } from "../lib/enterToSubmit";
import { EmptyState } from "../components/EmptyState";

// A list of the user's own support tickets — each message to the team is
// its own trackable ticket now (see lib/support.ts's own top comment for
// why this replaced a single ever-growing conversation), not one ongoing
// thread. Tapping a ticket opens its full conversation (app/support/[id].tsx);
// the composer below always starts a brand new one.
export default function SupportScreen() {
  const goBack = useGoBack("/(tabs)/profile");
  const router = useRouter();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const [tickets, setTickets] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    fetchMySupportMessages()
      .then(setTickets)
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleSend() {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      const created = await sendSupportMessage(body);
      setBody("");
      router.push({ pathname: "/support/[id]", params: { id: created.id } });
    } catch {
      alert(t.support.title, t.support.sendFailed);
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t.support.title}</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : tickets.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState icon="chatbubbles-outline" title={t.support.empty} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {tickets.map((ticket) => (
            <Pressable
              key={ticket.id}
              style={styles.ticketRow}
              onPress={() => router.push({ pathname: "/support/[id]", params: { id: ticket.id } })}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.ticketPreview} numberOfLines={2}>
                  {ticket.body}
                </Text>
                <Text style={styles.ticketDate}>{shortDate(ticket.created_at)}</Text>
              </View>
              <Pill size="sm" color={ticket.status === "resolved" ? colors.greenLight : colors.pillBg} textColor={colors.textMuted}>
                {ticket.status === "resolved" ? t.support.statusResolved : t.support.statusOpen}
              </Pill>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </Pressable>
          ))}
        </ScrollView>
      )}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder={t.support.placeholder}
          placeholderTextColor={colors.textFaint}
          value={body}
          onChangeText={setBody}
          onKeyPress={enterToSubmit(handleSend)}
          multiline
        />
        <Pressable
          style={[styles.sendBtn, (!body.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!body.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel={t.support.newMessage}
        >
          {sending ? <ActivityIndicator size="small" color={colors.onAccent} /> : <Ionicons name="add" size={20} color={colors.onAccent} />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
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
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: { fontSize: type.title, fontWeight: "800", color: colors.text },
    emptyWrap: { flex: 1, justifyContent: "center" },
    list: { padding: 16, gap: 10 },
    ticketRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: 14,
    },
    ticketPreview: { fontSize: type.bodySm, color: colors.text, lineHeight: 18 },
    ticketDate: { fontSize: type.caption, color: colors.textMuted, marginTop: 4 },
    composer: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 10,
      padding: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
    input: {
      flex: 1,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.text,
      fontSize: type.input,
      maxHeight: 100,
    },
    sendBtn: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    sendBtnDisabled: { opacity: 0.5 },
  });
}
