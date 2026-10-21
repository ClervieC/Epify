import { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";
import { fetchReportById, Report } from "../../lib/reports";
import { shortDate } from "../../lib/dates";
import { Pill } from "../../components/Pill";
import { useGoBack } from "../../lib/useGoBack";

// A reporter viewing their own filed report in full — reached by tapping a
// report_response notification (see app/notifications.tsx), where before
// there was no way to see the photos attached, or even which report a
// reply was about beyond a truncated one-liner crammed into the
// notification text itself.
export default function ReportDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const goBack = useGoBack("/notifications");
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      fetchReportById(id).then((data) => {
        if (active) {
          setReport(data);
          setLoading(false);
        }
      });
      return () => {
        active = false;
      };
    }, [id])
  );

  const statusTone = report?.status === "resolved" ? colors.green : report?.status === "dismissed" ? colors.red : colors.accent;
  const statusLabel =
    report?.status === "resolved" ? t.admin.resolved : report?.status === "dismissed" ? t.admin.dismissed : t.admin.open;

  return (
    <View style={styles.container}>
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
        <ScrollView contentContainerStyle={styles.body}>
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

          {report.admin_reply ? (
            <View style={[styles.card, styles.replyCard]}>
              <View style={styles.replyHeader}>
                <Ionicons name="arrow-undo" size={16} color={colors.accent} />
                <Text style={styles.replyLabel}>{t.report.replyLabel}</Text>
              </View>
              <Text style={styles.replyText}>{report.admin_reply}</Text>
              {report.admin_reply_at && <Text style={styles.date}>{shortDate(report.admin_reply_at)}</Text>}
            </View>
          ) : (
            <Text style={styles.noReplyText}>{t.report.noReplyYet}</Text>
          )}
        </ScrollView>
      )}

      {viewerUrl && (
        <Pressable style={styles.viewerOverlay} onPress={() => setViewerUrl(null)} accessibilityRole="button" accessibilityLabel={t.report.closePhoto}>
          <Image source={{ uri: viewerUrl }} style={styles.viewerImage} contentFit="contain" />
          <Pressable style={styles.viewerClose} onPress={() => setViewerUrl(null)} hitSlop={10}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
        </Pressable>
      )}
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
    notFound: { textAlign: "center", color: colors.textMuted, marginTop: 32 },
    body: { padding: 16, gap: 12 },
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
    replyCard: { backgroundColor: colors.accentSoft, gap: 6 },
    replyHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
    replyLabel: { fontSize: type.caption, fontWeight: "800", color: colors.accentDark },
    replyText: { fontSize: type.body, color: colors.text, lineHeight: 20 },
    noReplyText: { fontSize: type.bodySm, color: colors.textFaint, textAlign: "center", marginTop: 8 },
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
