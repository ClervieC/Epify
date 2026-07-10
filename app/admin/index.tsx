import { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, TextInput } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../context/AuthContext";
import { fetchMyProfile } from "../../lib/profiles";
import { fetchReports, resolveReport, dismissReport, Report, ReportStatus, ReportTargetType } from "../../lib/reports";
import { useLanguage } from "../../lib/i18n";
import { alert } from "../../lib/alert";
import { useGoBack } from "../../lib/useGoBack";

// Deliberately not using lib/theme.ts's useColors()/light-dark palette — an
// admin moderation console reads content other users flagged as abusive or
// broken; keeping it visually distinct (dark, fixed, slightly clinical)
// from the rest of the app is the point, so there's never a moment of
// confusing it for a normal in-app screen, on either light or dark system
// theme.
const C = {
  bg: "#0a0c10",
  surface: "#14171d",
  border: "#262b34",
  text: "#e8eaed",
  textMuted: "#8b92a0",
  accent: "#4d8cff",
  red: "#ff5c5c",
  green: "#3ecf8e",
  yellow: "#e0a400",
};

const STATUS_TABS: ReportStatus[] = ["open", "resolved", "dismissed"];

const TARGET_ICON: Record<ReportTargetType, keyof typeof Ionicons.glyphMap> = {
  user: "person-outline",
  comment: "chatbubble-outline",
  movie_comment: "chatbubble-outline",
  show: "tv-outline",
  episode: "film-outline",
  movie: "videocam-outline",
};

export default function AdminScreen() {
  const router = useRouter();
  const goBack = useGoBack("/(tabs)/profile");
  const { session } = useAuth();
  const { t } = useLanguage();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [status, setStatus] = useState<ReportStatus>("open");
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  // Gated server-side too (see the "Admins view/update all reports" RLS
  // policies in supabase/schema.sql) — this client-side check is purely so
  // a non-admin who somehow lands on /admin sees a plain "not authorized"
  // screen instead of an empty moderation console that looks broken.
  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      fetchMyProfile().then((p) => setAuthorized(!!p?.is_admin));
    }, [session])
  );

  const load = useCallback((s: ReportStatus) => {
    setLoading(true);
    fetchReports(s)
      .then(setReports)
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (authorized) load(status);
    }, [authorized, status, load])
  );

  if (authorized === null) {
    return (
      <View style={[styles.center, { backgroundColor: C.bg }]}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  if (!authorized) {
    return (
      <View style={[styles.center, { backgroundColor: C.bg }]}>
        <Ionicons name="lock-closed-outline" size={32} color={C.textMuted} />
        <Text style={styles.notAuthorized}>Not authorized</Text>
        <Pressable onPress={() => router.replace("/(tabs)/profile")} style={{ marginTop: 16 }}>
          <Text style={{ color: C.accent }}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t.admin.title}</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.tabs}>
        {STATUS_TABS.map((s) => (
          <Pressable key={s} style={[styles.tab, status === s && styles.tabActive]} onPress={() => setStatus(s)}>
            <Text style={[styles.tabText, status === s && styles.tabTextActive]}>
              {s === "open" ? t.admin.open : s === "resolved" ? t.admin.resolved : t.admin.dismissed}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 24 }} />
      ) : reports.length === 0 ? (
        <Text style={styles.empty}>{t.admin.noReports}</Text>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
          {reports.map((r) => (
            <ReportCard key={r.id} report={r} onActed={() => load(status)} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function targetSummary(r: Report): string {
  switch (r.target_type) {
    case "user":
      return `user ${r.target_user_id?.slice(0, 8)}`;
    case "comment":
      return `comment ${r.target_comment_id?.slice(0, 8)}`;
    case "movie_comment":
      return `movie comment ${r.target_movie_comment_id?.slice(0, 8)}`;
    case "show":
      return `show #${r.target_tvmaze_show_id}`;
    case "episode":
      return `episode #${r.target_tvmaze_episode_id} (show #${r.target_tvmaze_show_id})`;
    case "movie":
      return `movie #${r.target_tmdb_id}`;
  }
}

function ReportCard({ report, onActed }: { report: Report; onActed: () => void }) {
  const { t } = useLanguage();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(action: "resolve" | "dismiss") {
    setBusy(true);
    try {
      await (action === "resolve" ? resolveReport : dismissReport)(report.id, note.trim() || null);
      onActed();
    } catch {
      alert("Failed", "Couldn't update this report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name={TARGET_ICON[report.target_type]} size={16} color={C.accent} />
        <Text style={styles.cardTarget}>{targetSummary(report)}</Text>
        <Text style={styles.cardDate}>{report.created_at.slice(0, 10)}</Text>
      </View>
      <Text style={styles.cardReason}>{report.reason}</Text>
      <Text style={styles.cardMeta}>
        {t.admin.reportedBy} {report.reporter_id.slice(0, 8)}
      </Text>

      {report.status === "open" && (
        <>
          <TextInput
            style={styles.noteInput}
            placeholder={t.admin.resolutionNotePlaceholder}
            placeholderTextColor={C.textMuted}
            value={note}
            onChangeText={setNote}
          />
          <View style={styles.actionRow}>
            <Pressable style={[styles.actionBtn, styles.resolveBtn]} onPress={() => act("resolve")} disabled={busy}>
              <Text style={styles.actionBtnText}>{t.admin.resolve}</Text>
            </Pressable>
            <Pressable style={[styles.actionBtn, styles.dismissBtn]} onPress={() => act("dismiss")} disabled={busy}>
              <Text style={styles.actionBtnText}>{t.admin.dismiss}</Text>
            </Pressable>
          </View>
        </>
      )}
      {report.status !== "open" && report.resolution_note && (
        <Text style={styles.cardResolutionNote}>{report.resolution_note}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  notAuthorized: { color: C.text, fontWeight: "700", fontSize: 16 },
  container: { flex: 1, backgroundColor: C.bg },
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
  headerTitle: { color: C.text, fontWeight: "800", fontSize: 17, letterSpacing: 0.3 },
  tabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  tab: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, backgroundColor: C.surface },
  tabActive: { backgroundColor: C.accent },
  tabText: { color: C.textMuted, fontSize: 13, fontWeight: "700" },
  tabTextActive: { color: "#ffffff" },
  empty: { color: C.textMuted, textAlign: "center", marginTop: 32 },
  card: { backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  cardTarget: { flex: 1, color: C.text, fontWeight: "700", fontSize: 13 },
  cardDate: { color: C.textMuted, fontSize: 11 },
  cardReason: { color: C.text, fontSize: 13, lineHeight: 18, marginBottom: 6 },
  cardMeta: { color: C.textMuted, fontSize: 11, marginBottom: 8 },
  cardResolutionNote: { color: C.textMuted, fontSize: 12, fontStyle: "italic", marginTop: 4 },
  noteInput: {
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: C.text,
    fontSize: 13,
    marginBottom: 8,
  },
  actionRow: { flexDirection: "row", gap: 8 },
  actionBtn: { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: "center" },
  resolveBtn: { backgroundColor: C.green },
  dismissBtn: { backgroundColor: C.red },
  actionBtnText: { color: "#0a0c10", fontWeight: "800", fontSize: 12 },
});
