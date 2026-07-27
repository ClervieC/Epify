import { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, TextInput } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../context/AuthContext";
import { fetchMyProfile, fetchAllProfilesForAdmin, setUserBanned, setUserAdmin, Profile } from "../../lib/profiles";
import { fetchReports, resolveReport, dismissReport, Report, ReportStatus, ReportTargetType } from "../../lib/reports";
import { fetchSupportConversationsForAdmin, SupportConversation } from "../../lib/support";
import { useLanguage } from "../../lib/i18n";
import { shortDate } from "../../lib/dates";
import { alert } from "../../lib/alert";
import { useGoBack } from "../../lib/useGoBack";
import { C } from "../../lib/adminTheme";

const STATUS_TABS: ReportStatus[] = ["open", "resolved", "dismissed"];

const TARGET_ICON: Record<ReportTargetType, keyof typeof Ionicons.glyphMap> = {
  user: "person-outline",
  comment: "chatbubble-outline",
  movie_comment: "chatbubble-outline",
  show: "tv-outline",
  episode: "film-outline",
  movie: "videocam-outline",
};

const TARGET_COLOR: Record<ReportTargetType, string> = {
  user: C.red,
  comment: C.accent,
  movie_comment: C.accent,
  show: C.yellow,
  episode: C.yellow,
  movie: C.yellow,
};

export default function AdminScreen() {
  const router = useRouter();
  const goBack = useGoBack("/(tabs)/profile");
  const { session } = useAuth();
  const { t } = useLanguage();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [view, setView] = useState<"reports" | "users" | "support">("reports");
  const [status, setStatus] = useState<ReportStatus>("open");
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<Profile[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [conversations, setConversations] = useState<SupportConversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);

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

  const loadUsers = useCallback((query: string) => {
    setUsersLoading(true);
    fetchAllProfilesForAdmin(query)
      .then(setUsers)
      .finally(() => setUsersLoading(false));
  }, []);

  const loadConversations = useCallback(() => {
    setConversationsLoading(true);
    fetchSupportConversationsForAdmin()
      .then(setConversations)
      .finally(() => setConversationsLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (authorized && view === "reports") load(status);
    }, [authorized, view, status, load])
  );

  useFocusEffect(
    useCallback(() => {
      if (authorized && view === "users") loadUsers(userQuery);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authorized, view])
  );

  useFocusEffect(
    useCallback(() => {
      if (authorized && view === "support") loadConversations();
    }, [authorized, view, loadConversations])
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
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t.admin.title}</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.segmented}>
        {(
          [
            ["reports", t.admin.reportsTab, "flag-outline"],
            ["users", t.admin.usersTab, "people-outline"],
            ["support", t.admin.supportTab, "chatbubbles-outline"],
          ] as const
        ).map(([key, label, icon]) => (
          <Pressable key={key} style={[styles.segment, view === key && styles.segmentActive]} onPress={() => setView(key)}>
            <Ionicons name={icon} size={15} color={view === key ? "#fff" : C.textMuted} />
            <Text style={[styles.segmentText, view === key && styles.segmentTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {view === "reports" ? (
        <>
          <View style={styles.chipRow}>
            {STATUS_TABS.map((s) => (
              <Pressable key={s} style={[styles.chip, status === s && styles.chipActive]} onPress={() => setStatus(s)}>
                <Text style={[styles.chipText, status === s && styles.chipTextActive]}>
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
            <ScrollView contentContainerStyle={styles.list}>
              {reports.map((r) => (
                <ReportCard key={r.id} report={r} onActed={() => load(status)} />
              ))}
            </ScrollView>
          )}
        </>
      ) : view === "users" ? (
        <>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color={C.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder={t.admin.searchUsersPlaceholder}
              placeholderTextColor={C.textMuted}
              value={userQuery}
              onChangeText={setUserQuery}
              onSubmitEditing={() => loadUsers(userQuery)}
            />
          </View>
          {usersLoading ? (
            <ActivityIndicator color={C.accent} style={{ marginTop: 24 }} />
          ) : users.length === 0 ? (
            <Text style={styles.empty}>{t.admin.noUsers}</Text>
          ) : (
            <ScrollView contentContainerStyle={styles.list}>
              {users.map((u) => (
                <UserCard key={u.user_id} profile={u} onActed={() => loadUsers(userQuery)} />
              ))}
            </ScrollView>
          )}
        </>
      ) : conversationsLoading ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 24 }} />
      ) : conversations.length === 0 ? (
        <Text style={styles.empty}>{t.admin.noConversations}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {conversations.map((c) => (
            <Pressable
              key={c.userId}
              style={styles.conversationRow}
              onPress={() => router.push({ pathname: "/admin/support/[userId]", params: { userId: c.userId } })}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{c.username[0]?.toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.conversationTopRow}>
                  <Text style={styles.conversationName} numberOfLines={1}>
                    {c.username}
                  </Text>
                  <Text style={styles.conversationDate}>{shortDate(c.lastAt)}</Text>
                </View>
                <Text style={styles.conversationPreview} numberOfLines={1}>
                  {c.lastBody}
                </Text>
              </View>
              {c.needsResponse && <View style={styles.needsResponseDot} />}
              <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function targetSummary(t: ReturnType<typeof useLanguage>["t"], r: Report): string {
  switch (r.target_type) {
    case "user":
      return `${t.admin.targetUser} · ${r.target_user_id?.slice(0, 8)}`;
    case "comment":
      return `${t.admin.targetComment} · ${r.target_comment_id?.slice(0, 8)}`;
    case "movie_comment":
      return `${t.admin.targetMovieComment} · ${r.target_movie_comment_id?.slice(0, 8)}`;
    case "show":
      return `${t.admin.targetShow} #${r.target_tvmaze_show_id}`;
    case "episode":
      return `${t.admin.targetEpisode} #${r.target_tvmaze_episode_id}`;
    case "movie":
      return `${t.admin.targetMovie} #${r.target_tmdb_id}`;
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

  const color = TARGET_COLOR[report.target_type];

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.iconWrap, { backgroundColor: `${color}22` }]}>
          <Ionicons name={TARGET_ICON[report.target_type]} size={15} color={color} />
        </View>
        <Text style={styles.cardTarget} numberOfLines={1}>
          {targetSummary(t, report)}
        </Text>
        <Text style={styles.cardDate}>{shortDate(report.created_at)}</Text>
      </View>

      <Text style={styles.cardReason}>{report.reason}</Text>

      <View style={styles.cardMetaRow}>
        <Ionicons name="person-circle-outline" size={13} color={C.textMuted} />
        <Text style={styles.cardMeta}>
          {t.admin.reportedBy} {report.reporter_id.slice(0, 8)}
        </Text>
      </View>

      {report.status === "open" ? (
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
              <Ionicons name="checkmark" size={14} color="#0a0c10" />
              <Text style={styles.actionBtnText}>{t.admin.resolve}</Text>
            </Pressable>
            <Pressable style={[styles.actionBtn, styles.dismissBtn]} onPress={() => act("dismiss")} disabled={busy}>
              <Ionicons name="close" size={14} color="#0a0c10" />
              <Text style={styles.actionBtnText}>{t.admin.dismiss}</Text>
            </Pressable>
          </View>
        </>
      ) : (
        report.resolution_note && (
          <View style={styles.quoteBlock}>
            <Text style={styles.quoteText}>{report.resolution_note}</Text>
          </View>
        )
      )}
    </View>
  );
}

function UserCard({ profile, onActed }: { profile: Profile; onActed: () => void }) {
  const { t } = useLanguage();
  const [banBusy, setBanBusy] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);

  async function toggleBanned() {
    setBanBusy(true);
    try {
      await setUserBanned(profile.user_id, !profile.is_banned);
      onActed();
    } catch {
      alert("Failed", "Couldn't update this user.");
    } finally {
      setBanBusy(false);
    }
  }

  async function toggleAdmin() {
    setAdminBusy(true);
    try {
      await setUserAdmin(profile.user_id, !profile.is_admin);
      onActed();
    } catch {
      alert("Failed", "Couldn't update this user.");
    } finally {
      setAdminBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.userRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{profile.username[0]?.toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.cardTarget} numberOfLines={1}>
            {profile.username}
          </Text>
          <View style={styles.badgeRow}>
            {profile.is_admin && (
              <View style={[styles.badge, { backgroundColor: `${C.accent}22` }]}>
                <Text style={[styles.badgeText, { color: C.accent }]}>{t.admin.adminBadge}</Text>
              </View>
            )}
            {profile.is_banned && (
              <View style={[styles.badge, { backgroundColor: `${C.red}22` }]}>
                <Text style={[styles.badgeText, { color: C.red }]}>{t.admin.bannedLabel}</Text>
              </View>
            )}
          </View>
        </View>
      </View>
      <View style={styles.actionRow}>
        <Pressable
          style={[styles.actionBtn, profile.is_admin ? styles.dismissBtn : styles.replyBtn]}
          onPress={toggleAdmin}
          disabled={adminBusy}
        >
          <Ionicons name={profile.is_admin ? "shield-outline" : "shield-checkmark-outline"} size={14} color={profile.is_admin ? "#0a0c10" : "#fff"} />
          <Text style={[styles.actionBtnText, !profile.is_admin && { color: "#fff" }]}>
            {profile.is_admin ? t.admin.demote : t.admin.promote}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, profile.is_banned ? styles.resolveBtn : styles.dismissBtn]}
          onPress={toggleBanned}
          disabled={banBusy || profile.is_admin}
        >
          <Ionicons name={profile.is_banned ? "lock-open-outline" : "lock-closed-outline"} size={14} color="#0a0c10" />
          <Text style={styles.actionBtnText}>{profile.is_banned ? t.admin.unban : t.admin.ban}</Text>
        </Pressable>
      </View>
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
  segmented: {
    flexDirection: "row",
    margin: 16,
    marginBottom: 8,
    backgroundColor: C.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    padding: 3,
    gap: 3,
  },
  segment: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 8, borderRadius: 8 },
  segmentActive: { backgroundColor: C.accent },
  segmentText: { color: C.textMuted, fontSize: 12, fontWeight: "700" },
  segmentTextActive: { color: "#fff" },
  chipRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  chip: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  chipActive: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { color: C.textMuted, fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: "#fff" },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
  },
  searchInput: { flex: 1, color: C.text, fontSize: 13 },
  empty: { color: C.textMuted, textAlign: "center", marginTop: 32 },
  list: { padding: 16, paddingTop: 0, gap: 10 },
  card: { backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, gap: 8 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconWrap: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  cardTarget: { flex: 1, color: C.text, fontWeight: "700", fontSize: 13 },
  cardDate: { color: C.textMuted, fontSize: 11 },
  cardReason: { color: C.text, fontSize: 13, lineHeight: 18 },
  cardMetaRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  cardMeta: { color: C.textMuted, fontSize: 11 },
  quoteBlock: { borderLeftWidth: 2, borderLeftColor: C.accent, paddingLeft: 10 },
  quoteText: { color: C.textMuted, fontSize: 12, fontStyle: "italic", lineHeight: 17 },
  noteInput: {
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: C.text,
    fontSize: 13,
  },
  actionRow: { flexDirection: "row", gap: 8 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, borderRadius: 8 },
  actionBtnDisabled: { opacity: 0.5 },
  resolveBtn: { backgroundColor: C.green },
  reopenBtn: { backgroundColor: C.yellow },
  replyBtn: { backgroundColor: C.accent },
  dismissBtn: { backgroundColor: C.red },
  actionBtnText: { color: "#0a0c10", fontWeight: "800", fontSize: 12 },
  userRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: C.text, fontWeight: "800", fontSize: 14 },
  badgeRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  badgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  conversationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
  },
  conversationTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  conversationName: { color: C.text, fontWeight: "700", fontSize: 13, flexShrink: 1 },
  conversationDate: { color: C.textMuted, fontSize: 11 },
  conversationPreview: { color: C.textMuted, fontSize: 12, marginTop: 2 },
  needsResponseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent },
});
