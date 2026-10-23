import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";
import {
  fetchSupportMessageById,
  fetchSupportReplies,
  sendSupportReply,
  subscribeToSupportReplies,
  mergeReply,
  SupportMessage,
  SupportReply,
} from "../../lib/support";
import { supabase } from "../../lib/supabase";
import { alert } from "../../lib/alert";
import { Pill } from "../../components/Pill";
import { useGoBack } from "../../lib/useGoBack";
import { enterToSubmit } from "../../lib/enterToSubmit";

interface ThreadItem {
  key: string;
  body: string;
  isAdmin: boolean;
}

// One support ticket's own conversation — reached from the ticket list in
// app/support.tsx. Mirrors app/reports/[id].tsx's thread+composer shape
// exactly (the two features share the same underlying ticket model now).
export default function SupportTicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const goBack = useGoBack("/support");
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const [ticket, setTicket] = useState<SupportMessage | null>(null);
  const [replies, setReplies] = useState<SupportReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    const [data, replyData] = await Promise.all([fetchSupportMessageById(id), fetchSupportReplies(id)]);
    setTicket(data);
    setReplies(replyData);
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Live replies from an admin, without needing to leave/refocus the
  // screen to see them — mergeReply drops the echo of this device's own
  // just-sent reply instead of double-adding it.
  useEffect(() => {
    if (!ticket) return;
    const channel = subscribeToSupportReplies(ticket.id, (reply) => {
      setReplies((prev) => mergeReply(prev, reply));
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [ticket?.id]);

  async function handleSend() {
    if (!body.trim() || sending || !ticket) return;
    setSending(true);
    try {
      const created = await sendSupportReply(ticket.id, body);
      setReplies((prev) => [...prev, created]);
      // A reply on a resolved ticket reopens it server-side (see
      // sendSupportReply) — reflected here too so the status pill updates
      // immediately instead of only after the next full reload.
      setTicket((prev) => (prev ? { ...prev, status: "open" } : prev));
      setBody("");
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch {
      alert(t.support.title, t.support.replyFailed);
    } finally {
      setSending(false);
    }
  }

  const thread: ThreadItem[] = ticket
    ? [
        { key: "original", body: ticket.body, isAdmin: false },
        // A ticket answered under the old single-resolution_note model (no
        // rows in support_message_replies yet) already has its answer —
        // without this it would look permanently unanswered.
        ...(ticket.resolution_note && replies.length === 0
          ? [{ key: "resolution", body: ticket.resolution_note, isAdmin: true }]
          : []),
        ...replies.map((r) => ({ key: r.id, body: r.body, isAdmin: r.is_admin })),
      ]
    : [];

  const statusTone = ticket?.status === "resolved" ? colors.green : colors.accent;
  const statusLabel = ticket?.status === "resolved" ? t.support.statusResolved : t.support.statusOpen;

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
        <Text style={styles.title}>{t.support.conversationTitle}</Text>
        {ticket ? (
          <Pill size="sm" color={`${statusTone}22`} textColor={statusTone}>
            {statusLabel}
          </Pill>
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : !ticket ? (
        <Text style={styles.notFound}>{t.support.notFound}</Text>
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.thread}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {thread.map((item) => (
            <View key={item.key} style={[styles.bubbleRow, item.isAdmin ? styles.bubbleRowLeft : styles.bubbleRowRight]}>
              <View style={[styles.bubble, item.isAdmin ? styles.bubbleAdmin : styles.bubbleUser]}>
                <Text style={styles.bubbleAuthor}>{item.isAdmin ? t.support.team : t.support.you}</Text>
                <Text style={[styles.bubbleText, item.isAdmin ? styles.bubbleTextAdmin : styles.bubbleTextUser]}>{item.body}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {ticket && (
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder={t.support.replyPlaceholder}
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
            accessibilityLabel={t.support.sendReply}
          >
            {sending ? <ActivityIndicator size="small" color={colors.onAccent} /> : <Ionicons name="send" size={18} color={colors.onAccent} />}
          </Pressable>
        </View>
      )}
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
    notFound: { textAlign: "center", color: colors.textMuted, marginTop: 32 },
    thread: { padding: 16, gap: 10 },
    bubbleRow: { flexDirection: "row" },
    bubbleRowLeft: { justifyContent: "flex-start" },
    bubbleRowRight: { justifyContent: "flex-end" },
    bubble: { maxWidth: "80%", borderRadius: radius.lg, padding: 12 },
    bubbleAdmin: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    bubbleUser: { backgroundColor: colors.accent },
    bubbleAuthor: { fontSize: type.micro, fontWeight: "800", color: colors.textFaint, marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 },
    bubbleText: { fontSize: type.bodySm, lineHeight: 19 },
    bubbleTextAdmin: { color: colors.text },
    bubbleTextUser: { color: colors.onAccent },
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
