import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Linking, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  fetchReportById,
  fetchReportReplies,
  sendReportReply,
  resolveReport,
  dismissReport,
  subscribeToReportReplies,
  mergeReportReply,
  Report,
  ReportReply,
} from "../../../lib/reports";
import { resolveReportTargets, targetSummary, targetHref, TARGET_ICON, TARGET_COLOR, ResolvedReportTargets } from "../../../lib/reportTargets";
import { supabase } from "../../../lib/supabase";
import { useLanguage } from "../../../lib/i18n";
import { shortDate } from "../../../lib/dates";
import { alert } from "../../../lib/alert";
import { useGoBack } from "../../../lib/useGoBack";
import { enterToSubmit } from "../../../lib/enterToSubmit";
import { C } from "../../../lib/adminTheme";

interface ThreadItem {
  key: string;
  body: string;
  isAdmin: boolean;
}

const EMPTY_TARGETS: ResolvedReportTargets = {
  userNames: new Map(),
  showNames: new Map(),
  episodeInfo: new Map(),
  commentInfo: new Map(),
  movieCommentInfo: new Map(),
};

// One report's own full ticket — reached from the compact list in
// app/admin/index.tsx. Same thread+composer shape as
// app/admin/support/[userId].tsx, plus the report-specific bits support
// tickets don't have: a target to link through to, photos, and the
// resolve/dismiss moderation actions.
export default function AdminReportThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const goBack = useGoBack("/admin");
  const router = useRouter();
  const { t } = useLanguage();
  const [report, setReport] = useState<Report | null>(null);
  const [replies, setReplies] = useState<ReportReply[]>([]);
  const [targets, setTargets] = useState<ResolvedReportTargets>(EMPTY_TARGETS);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [acting, setActing] = useState(false);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    const data = await fetchReportById(id);
    setReport(data);
    if (data) {
      const [replyData, resolvedTargets] = await Promise.all([fetchReportReplies(data.id), resolveReportTargets([data])]);
      setReplies(replyData);
      setTargets(resolvedTargets);
    }
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Live replies from the reporter, without needing to leave/refocus the
  // screen to see them — mergeReportReply drops the echo of the admin's own
  // just-sent reply instead of double-adding it.
  useEffect(() => {
    if (!report) return;
    const channel = subscribeToReportReplies(report.id, (reply) => {
      setReplies((prev) => mergeReportReply(prev, reply));
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [report?.id]);

  async function handleSend() {
    if (!body.trim() || sending || !report) return;
    setSending(true);
    try {
      const created = await sendReportReply(report.id, body);
      setReplies((prev) => [...prev, created]);
      setBody("");
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch {
      alert("Failed", "Couldn't send your reply.");
    } finally {
      setSending(false);
    }
  }

  async function act(action: "resolve" | "dismiss") {
    if (!report) return;
    setActing(true);
    try {
      await (action === "resolve" ? resolveReport : dismissReport)(report.id, note.trim() || null);
      await load();
    } catch {
      alert("Failed", "Couldn't update this report.");
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

  if (!report) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Report not found.</Text>
      </View>
    );
  }

  const href = targetHref(report, targets);
  const color = TARGET_COLOR[report.target_type];
  const thread: ThreadItem[] = [
    ...(report.admin_reply && replies.length === 0 ? [{ key: "legacy", body: report.admin_reply, isAdmin: true }] : []),
    ...replies.map((r) => ({ key: r.id, body: r.body, isAdmin: r.is_admin })),
  ];
  const reporterName = targets.userNames.get(report.reporter_id) ?? report.reporter_id.slice(0, 8);

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
        <View style={styles.headerTargetWrap}>
          <View style={[styles.iconWrap, { backgroundColor: `${color}22` }]}>
            <Ionicons name={TARGET_ICON[report.target_type]} size={13} color={color} />
          </View>
          {href ? (
            <Pressable onPress={() => router.push(href as never)} style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.headerTitle, styles.headerTitleLink]} numberOfLines={1}>
                {targetSummary(t.admin, report, targets)}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.headerTitle} numberOfLines={1}>
              {targetSummary(t.admin, report, targets)}
            </Text>
          )}
        </View>
        <View
          style={[
            styles.statusPill,
            report.status === "resolved" && styles.statusPillResolved,
            report.status === "dismissed" && styles.statusPillDismissed,
          ]}
        >
          <Text style={styles.statusPillText}>
            {report.status === "resolved" ? t.admin.resolved : report.status === "dismissed" ? t.admin.dismissed : t.admin.open}
          </Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.thread}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        <View style={styles.card}>
          <Text style={styles.cardReason}>{report.reason}</Text>

          {report.image_urls.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.reportImageRow}>
              {report.image_urls.map((url) => (
                <Pressable key={url} onPress={() => Linking.openURL(url)}>
                  <Image source={{ uri: url }} style={styles.reportImageThumb} contentFit="cover" />
                </Pressable>
              ))}
            </ScrollView>
          )}

          <View style={styles.cardMetaRow}>
            <Ionicons name="person-circle-outline" size={13} color={C.textMuted} />
            <Text style={styles.cardMeta}>
              {t.admin.reportedBy} {reporterName} · {shortDate(report.created_at)}
            </Text>
          </View>
        </View>

        {report.status === "open" ? (
          <View style={styles.card}>
            <TextInput
              style={styles.noteInput}
              placeholder={t.admin.resolutionNotePlaceholder}
              placeholderTextColor={C.textMuted}
              value={note}
              onChangeText={setNote}
            />
            <View style={styles.actionRow}>
              <Pressable style={[styles.actionBtn, styles.resolveBtn]} onPress={() => act("resolve")} disabled={acting}>
                <Ionicons name="checkmark" size={14} color="#0a0c10" />
                <Text style={styles.actionBtnText}>{t.admin.resolve}</Text>
              </Pressable>
              <Pressable style={[styles.actionBtn, styles.dismissBtn]} onPress={() => act("dismiss")} disabled={acting}>
                <Ionicons name="close" size={14} color="#0a0c10" />
                <Text style={styles.actionBtnText}>{t.admin.dismiss}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          report.resolution_note && (
            <View style={[styles.card, styles.quoteBlock]}>
              <Text style={styles.quoteText}>{report.resolution_note}</Text>
            </View>
          )
        )}

        {thread.map((item) => (
          <View key={item.key} style={[styles.bubbleRow, item.isAdmin ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
            <View style={[styles.bubble, item.isAdmin ? styles.bubbleAdmin : styles.bubbleUser]}>
              <Text style={styles.bubbleAuthor}>{item.isAdmin ? t.admin.you : reporterName}</Text>
              <Text style={styles.bubbleText}>{item.body}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder={t.admin.replyPlaceholder}
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
          accessibilityLabel={t.admin.sendReply}
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
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTargetWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 },
  iconWrap: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, color: C.text, fontWeight: "700", fontSize: 13 },
  headerTitleLink: { color: C.accent, textDecorationLine: "underline" },
  statusPill: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  statusPillResolved: { backgroundColor: `${C.green}22`, borderColor: C.green },
  statusPillDismissed: { backgroundColor: `${C.red}22`, borderColor: C.red },
  statusPillText: { fontSize: 11, fontWeight: "700", color: C.textMuted },
  thread: { padding: 16, gap: 10 },
  card: { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, gap: 8 },
  cardReason: { color: C.text, fontSize: 13, lineHeight: 18 },
  reportImageRow: { gap: 8 },
  reportImageThumb: { width: 72, height: 72, borderRadius: 8, backgroundColor: C.bg },
  cardMetaRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  cardMeta: { color: C.textMuted, fontSize: 11 },
  quoteBlock: { borderLeftWidth: 2, borderLeftColor: C.accent },
  quoteText: { color: C.textMuted, fontSize: 12, fontStyle: "italic", lineHeight: 17 },
  noteInput: {
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: C.text,
    fontSize: 16,
  },
  actionRow: { flexDirection: "row", gap: 8 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, borderRadius: 8 },
  resolveBtn: { backgroundColor: C.green },
  dismissBtn: { backgroundColor: C.red },
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
