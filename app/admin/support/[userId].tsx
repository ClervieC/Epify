import { useCallback, useRef, useState } from "react";
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
import { useLocalSearchParams, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { fetchProfile, Profile } from "../../../lib/profiles";
import {
  fetchUserSupportThread,
  markSupportThreadRead,
  sendAdminSupportReply,
  SupportMessage,
  SupportReply,
} from "../../../lib/support";
import { alert } from "../../../lib/alert";
import { useGoBack } from "../../../lib/useGoBack";
import { C } from "../../../lib/adminTheme";

interface ThreadItem {
  key: string;
  body: string;
  isAdmin: boolean;
}

// Admin's half of the same conversation app/support.tsx renders for the
// user — same bubble-thread shape, same reopens-on-reply behavior
// server-side (see lib/support.ts), just the dark admin palette and no
// "new ticket" composer since only the user side can start one.
export default function AdminSupportThreadScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const goBack = useGoBack("/admin");
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ticket, setTicket] = useState<SupportMessage | null>(null);
  const [replies, setReplies] = useState<SupportReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    const [p, thread] = await Promise.all([fetchProfile(userId), fetchUserSupportThread(userId)]);
    setProfile(p);
    setTicket(thread.ticket);
    setReplies(thread.replies);
    setLoading(false);
    // Opening the conversation is what clears its "needs reply" badge, not
    // sending a reply — see lib/support.ts's markSupportThreadRead.
    if (thread.ticket) markSupportThreadRead(thread.ticket.id).catch(() => {});
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
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
            {profile?.username ?? userId.slice(0, 8)}
          </Text>
        </Pressable>
        <View style={{ width: 22 }} />
      </View>

      {thread.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="chatbubbles-outline" size={28} color={C.textMuted} />
          <Text style={styles.emptyText}>No messages yet.</Text>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.thread}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {thread.map((item) => (
            <View key={item.key} style={[styles.bubbleRow, item.isAdmin ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
              <View style={[styles.bubble, item.isAdmin ? styles.bubbleAdmin : styles.bubbleUser]}>
                <Text style={styles.bubbleAuthor}>{item.isAdmin ? "You" : profile?.username ?? "User"}</Text>
                <Text style={styles.bubbleText}>{item.body}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Write a reply..."
          placeholderTextColor={C.textMuted}
          value={body}
          onChangeText={setBody}
          multiline
          editable={!!ticket}
        />
        <Pressable
          style={[styles.sendBtn, (!body.trim() || sending || !ticket) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!body.trim() || sending || !ticket}
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
  thread: { padding: 16, gap: 10 },
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
    fontSize: 14,
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
