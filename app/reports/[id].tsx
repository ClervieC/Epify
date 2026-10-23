import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";
import {
  fetchReportById,
  fetchReportReplies,
  sendReporterReply,
  subscribeToReportReplies,
  mergeReportReply,
  Report,
  ReportReply,
} from "../../lib/reports";
import { supabase } from "../../lib/supabase";
import { alert } from "../../lib/alert";
import { shortDate } from "../../lib/dates";
import { Pill } from "../../components/Pill";
import { useGoBack } from "../../lib/useGoBack";
import { enterToSubmit } from "../../lib/enterToSubmit";

// One bubble in the conversation — either the legacy single admin_reply (a
// report answered before this threaded view existed, shown as a synthetic
// admin bubble so it still reads fine) or a real report_replies row from
// either side.
interface ThreadItem {
  key: string;
  body: string;
  isAdmin: boolean;
}

// A reporter's own filed report, now a real back-and-forth — reached by
// tapping a report_response notification (see app/notifications.tsx), or by
// following up on a report they already filed. Mirrors app/support.tsx's
// thread+composer shape exactly, just with the report's own reason/photos/
// status kept as a fixed header above the thread instead of folded into it.
export default function ReportDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const goBack = useGoBack("/notifications");
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const [report, setReport] = useState<Report | null>(null);
  const [replies, setReplies] = useState<ReportReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    const [data, replyData] = await Promise.all([fetchReportById(id), fetchReportReplies(id)]);
    setReport(data);
    setReplies(replyData);
    setLoading(false);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Live replies from an admin, without needing to leave/refocus the screen
  // to see them — mergeReportReply drops the echo of this device's own
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
      const created = await sendReporterReply(report.id, body);
      setReplies((prev) => [...prev, created]);
      // A reply on a resolved/dismissed report reopens it server-side (see
      // sendReporterReply) — reflected here too so the status pill updates
      // immediately instead of only after the next full reload.
      setReport((prev) => (prev ? { ...prev, status: "open" } : prev));
      setBody("");
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch {
      alert(t.report.title, t.report.sendFailed);
    } finally {
      setSending(false);
    }
  }

  const statusTone = report?.status === "resolved" ? colors.green : report?.status === "dismissed" ? colors.red : colors.accent;
  const statusLabel =
    report?.status === "resolved" ? t.admin.resolved : report?.status === "dismissed" ? t.admin.dismissed : t.admin.open;

  const thread: ThreadItem[] = report
    ? [
        ...(report.admin_reply && replies.length === 0 ? [{ key: "legacy", body: report.admin_reply, isAdmin: true }] : []),
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
        <Text style={styles.title}>{t.report.title}</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : !report ? (
        <Text style={styles.notFound}>{t.report.notFound}</Text>
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.body}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          <View style={styles.card}>
            <View style={styles.statusRow}>
              <Pill size="sm" color={`${statusTone}22`} textColor={statusTone}>
                {statusLabel}
              </Pill>
              <Text style={styles.date}>{shortDate(report.created_at)}</Text>
            </View>
            <Text style={styles.reason}>{report.reason}</Text>

            {report.image_urls.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow} contentContainerStyle={styles.photoRowContent}>
                {report.image_urls.map((url) => (
                  <Pressable key={url} onPress={() => setViewerUrl(url)}>
                    <Image source={{ uri: url }} style={styles.photoThumb} contentFit="cover" />
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>

          {thread.map((item) => (
            <View key={item.key} style={[styles.bubbleRow, item.isAdmin ? styles.bubbleRowLeft : styles.bubbleRowRight]}>
              <View style={[styles.bubble, item.isAdmin ? styles.bubbleAdmin : styles.bubbleUser]}>
                <Text style={styles.bubbleAuthor}>{item.isAdmin ? t.report.team : t.report.you}</Text>
                <Text style={[styles.bubbleText, item.isAdmin ? styles.bubbleTextAdmin : styles.bubbleTextUser]}>{item.body}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {report && (
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder={t.report.composerPlaceholder}
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
            accessibilityLabel={t.report.send}
          >
            {sending ? <ActivityIndicator size="small" color={colors.onAccent} /> : <Ionicons name="send" size={18} color={colors.onAccent} />}
          </Pressable>
        </View>
      )}

      {viewerUrl && (
        <Pressable style={styles.viewerOverlay} onPress={() => setViewerUrl(null)} accessibilityRole="button" accessibilityLabel={t.report.closePhoto}>
          <Image source={{ uri: viewerUrl }} style={styles.viewerImage} contentFit="contain" />
          <Pressable style={styles.viewerClose} onPress={() => setViewerUrl(null)} hitSlop={10}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
        </Pressable>
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
    },
    title: { fontSize: type.title, fontWeight: "800", color: colors.text },
    notFound: { textAlign: "center", color: colors.textMuted, marginTop: 32 },
    body: { padding: 16, gap: 10 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: 14,
    },
    statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
    date: { fontSize: type.caption, color: colors.textMuted },
    reason: { fontSize: type.body, color: colors.text, lineHeight: 20 },
    photoRow: { marginTop: 12 },
    photoRowContent: { gap: 8 },
    photoThumb: { width: 84, height: 84, borderRadius: radius.sm, backgroundColor: colors.backgroundAlt },
    bubbleRow: { flexDirection: "row" },
    bubbleRowLeft: { justifyContent: "flex-start" },
    bubbleRowRight: { justifyContent: "flex-end" },
    bubble: { maxWidth: "80%", borderRadius: radius.lg, padding: 12 },
    bubbleAdmin: { backgroundColor: colors.accentSoft },
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
    viewerOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.92)",
      alignItems: "center",
      justifyContent: "center",
    },
    viewerImage: { width: "100%", height: "80%" },
    viewerClose: {
      position: "absolute",
      top: 50,
      right: 20,
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      backgroundColor: "rgba(255,255,255,0.15)",
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
