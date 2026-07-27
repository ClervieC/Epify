import { useCallback, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import {
  fetchMySupportMessages,
  fetchSupportReplies,
  sendSupportMessage,
  sendSupportReply,
  SupportMessage,
  SupportReply,
} from "../lib/support";
import { alert } from "../lib/alert";
import { useGoBack } from "../lib/useGoBack";
import { EmptyState } from "../components/EmptyState";

// One bubble in the conversation — either the current ticket's own original
// message (support_messages.body, always "from" the user) or one of its
// replies from either side. A legacy resolved ticket with a resolution_note
// but no replies yet renders that note as a synthetic admin bubble, so
// tickets answered before this threaded view existed still show their answer.
interface ThreadItem {
  key: string;
  body: string;
  isAdmin: boolean;
}

// A single running conversation with support, not a picker over several
// separate tickets — simplest model for a user who just wants to talk to
// the team and get an answer, same shape as any chat app. The most recent
// support_messages row (if any) is "the" conversation; the first message
// ever sent creates it, everything after that is a reply on it (see
// lib/support.ts's sendSupportReply, which also reopens a resolved ticket).
export default function SupportScreen() {
  const goBack = useGoBack("/(tabs)/profile");
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
    const tickets = await fetchMySupportMessages();
    const current = tickets[0] ?? null;
    setTicket(current);
    setReplies(current ? await fetchSupportReplies(current.id) : []);
    setLoading(false);
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
      if (ticket) {
        const created = await sendSupportReply(ticket.id, body);
        setReplies((prev) => [...prev, created]);
        // A reply on a resolved ticket reopens it server-side (see
        // sendSupportReply) — reflected here too so the status pill updates
        // immediately instead of only after the next full reload.
        setTicket((prev) => (prev ? { ...prev, status: "open" } : prev));
      } else {
        const created = await sendSupportMessage(body);
        setTicket(created);
      }
      setBody("");
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch {
      alert(t.support.title, t.support.sendFailed);
    } finally {
      setSending(false);
    }
  }

  const thread: ThreadItem[] = ticket
    ? [
        { key: "original", body: ticket.body, isAdmin: false },
        ...(ticket.resolution_note && replies.length === 0
          ? [{ key: "resolution", body: ticket.resolution_note, isAdmin: true }]
          : []),
        ...replies.map((r) => ({ key: r.id, body: r.body, isAdmin: r.is_admin })),
      ]
    : [];

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
        {ticket ? (
          <View style={[styles.statusPill, ticket.status === "resolved" && styles.statusPillResolved]}>
            <Text style={styles.statusPillText}>
              {ticket.status === "resolved" ? t.support.statusResolved : t.support.statusOpen}
            </Text>
          </View>
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : thread.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState icon="chatbubbles-outline" title={t.support.empty} />
        </View>
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
                <Text style={[styles.bubbleText, item.isAdmin ? styles.bubbleTextAdmin : styles.bubbleTextUser]}>
                  {item.body}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder={ticket ? t.support.replyPlaceholder : t.support.placeholder}
          placeholderTextColor={colors.textFaint}
          value={body}
          onChangeText={setBody}
          multiline
        />
        <Pressable
          style={[styles.sendBtn, (!body.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!body.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel={t.support.send}
        >
          {sending ? <ActivityIndicator size="small" color={colors.onAccent} /> : <Ionicons name="send" size={18} color={colors.onAccent} />}
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
    statusPill: { backgroundColor: colors.pillBg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
    statusPillResolved: { backgroundColor: colors.greenLight },
    statusPillText: { fontSize: type.caption, fontWeight: "700", color: colors.textMuted },
    emptyWrap: { flex: 1, justifyContent: "center" },
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
      fontSize: type.body,
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
