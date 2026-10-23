import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import { useLocalSearchParams, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  fetchSupportMessageById,
  fetchSupportReplies,
  sendAdminSupportReply,
  resolveSupportTicket,
  subscribeToSupportReplies,
  mergeReply,
  SupportMessage,
  SupportReply,
} from "../../../lib/support";
import { fetchProfile, Profile } from "../../../lib/profiles";
import { supabase } from "../../../lib/supabase";
import { alert } from "../../../lib/alert";
import { useGoBack } from "../../../lib/useGoBack";
import { enterToSubmit } from "../../../lib/enterToSubmit";
import { C } from "../../../lib/adminTheme";

interface ThreadItem {
  key: string;
  body: string;
  isAdmin: boolean;
}

// One support ticket's own thread — reached from the compact list in
// app/admin/index.tsx. Same shape as app/admin/reports/[id].tsx (the two
// now share one ticket model), minus the target/dismiss bits reports have
// that a support message doesn't.
export default function AdminSupportTicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const goBack = useGoBack("/admin");
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ticket, setTicket] = useState<SupportMessage | null>(null);
  const [replies, setReplies] = useState<SupportReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    const data = await fetchSupportMessageById(id);
    setTicket(data);
    if (data) {
      const [replyData, p] = await Promise.all([fetchSupportReplies(data.id), fetchProfile(data.user_id)]);
      setReplies(replyData);
      setProfile(p);
    }
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Live replies from the user, without needing to leave/refocus the
  // screen to see them — mergeReply drops the echo of the admin's own
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
      const created = await sendAdminSupportReply(ticket.id, body);
      setReplies((prev) => [...prev, created]);
      setBody("");
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch {
      alert("Failed", "Couldn't send your reply.");
    } finally {
      setSending(false);
    }
  }

  async function handleResolve() {
    if (!ticket) return;
    setActing(true);
    try {
      await resolveSupportTicket(ticket.id);
      setTicket((prev) => (prev ? { ...prev, status: "resolved" } : prev));
    } catch {
      alert("Failed", "Couldn't update this ticket.");
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  if (!ticket) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Ticket not found.</Text>
      </View>
    );
  }

  const thread: ThreadItem[] = [
    { key: "original", body: ticket.body, isAdmin: false },
    ...(ticket.resolution_note && replies.length === 0 ? [{ key: "resolution", body: ticket.resolution_note, isAdmin: true }] : []),
    ...replies.map((r) => ({ key: r.id, body: r.body, isAdmin: r.is_admin })),
  ];

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </Pressable>
        <Pressable
          style={styles.headerUser}
          onPress={() => profile && router.push({ pathname: "/users/[id]", params: { id: profile.user_id } })}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(profile?.username ?? "?")[0]?.toUpperCase()}</Text>
          </View>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {profile?.username ?? ticket.user_id.slice(0, 8)}
          </Text>
        </Pressable>
        <View
          style={[styles.statusPill, ticket.status === "resolved" && styles.statusPillResolved]}
        >
          <Text style={styles.statusPillText}>{ticket.status === "resolved" ? "Resolved" : "Open"}</Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.thread}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {ticket.status === "open" && (
          <Pressable style={[styles.actionBtn, styles.resolveBtn]} onPress={handleResolve} disabled={acting}>
            <Ionicons name="checkmark" size={14} color="#0a0c10" />
            <Text style={styles.actionBtnText}>Mark resolved</Text>
          </Pressable>
        )}

        {thread.map((item) => (
          <View key={item.key} style={[styles.bubbleRow, item.isAdmin ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
            <View style={[styles.bubble, item.isAdmin ? styles.bubbleAdmin : styles.bubbleUser]}>
              <Text style={styles.bubbleAuthor}>{item.isAdmin ? "You" : profile?.username ?? "User"}</Text>
              <Text style={styles.bubbleText}>{item.body}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Write a reply..."
          placeholderTextColor={C.textMuted}
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
          accessibilityLabel="Send reply"
        >
          {sending ? <ActivityIndicator size="small" color="#0a0c10" /> : <Ionicons name="send" size={17} color="#0a0c10" />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.bg },
  emptyText: { color: C.textMuted, fontSize: 13 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerUser: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, justifyContent: "center" },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: C.text, fontWeight: "800", fontSize: 12 },
  headerTitle: { color: C.text, fontWeight: "800", fontSize: 15, letterSpacing: 0.2 },
  statusPill: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  statusPillResolved: { backgroundColor: `${C.green}22`, borderColor: C.green },
  statusPillText: { fontSize: 11, fontWeight: "700", color: C.textMuted },
  thread: { padding: 16, gap: 10 },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, borderRadius: 8 },
  resolveBtn: { backgroundColor: C.green },
  actionBtnText: { color: "#0a0c10", fontWeight: "800", fontSize: 12 },
  bubbleRow: { flexDirection: "row" },
  bubbleRowLeft: { justifyContent: "flex-start" },
  bubbleRowRight: { justifyContent: "flex-end" },
  bubble: { maxWidth: "80%", borderRadius: 12, padding: 12 },
  bubbleAdmin: { backgroundColor: C.accent },
  bubbleUser: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  bubbleAuthor: { fontSize: 10, fontWeight: "800", color: "rgba(255,255,255,0.7)", marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 },
  bubbleText: { fontSize: 13, lineHeight: 18, color: C.text },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.bg,
  },
  input: {
    flex: 1,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.text,
    // 16, not 14 — anything smaller makes iOS Safari auto-zoom the page on
    // focus instead of just focusing the input.
    fontSize: 16,
    maxHeight: 100,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.5 },
});
