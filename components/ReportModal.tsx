import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Sheet } from "./Sheet";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { createReport, CreateReportParams } from "../lib/reports";
import { alert } from "../lib/alert";

interface ReportModalProps {
  visible: boolean;
  onClose: () => void;
  // Everything the report needs except `reason`, which this collects —
  // callers pass whichever target_* field applies (see lib/reports.ts).
  target: Omit<CreateReportParams, "reason">;
}

// One shared reason-entry sheet for every reportable thing (a user, a
// comment, a show/episode/movie) rather than five near-identical modals —
// call sites only differ in which `target` they pass in.
export function ReportModal({ visible, onClose, target }: ReportModalProps) {
  const colors = useColors();
  const styles = useStyles(colors);
  const { t } = useLanguage();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!reason.trim()) return;
    setSubmitting(true);
    try {
      await createReport({ ...target, reason });
      setReason("");
      onClose();
      alert(t.report.submittedTitle, t.report.submittedMessage);
    } catch {
      alert(t.report.failedTitle, t.report.failedMessage);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>{t.report.title}</Text>
      <Text style={styles.subtitle}>{t.report.subtitle}</Text>
      <TextInput
        style={styles.input}
        placeholder={t.report.placeholder}
        placeholderTextColor={colors.textFaint}
        value={reason}
        onChangeText={setReason}
        multiline
        numberOfLines={4}
      />
      <Pressable
        style={[styles.submitBtn, (!reason.trim() || submitting) && styles.submitBtnDisabled]}
        onPress={handleSubmit}
        disabled={!reason.trim() || submitting}
        accessibilityRole="button"
        accessibilityLabel={t.report.submit}
      >
        {submitting ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.submitText}>{t.report.submit}</Text>}
      </Pressable>
    </Sheet>
  );
}

function useStyles(colors: Colors) {
  return StyleSheet.create({
    title: { fontSize: type.subtitle, fontWeight: "800", color: colors.text, marginBottom: 4 },
    subtitle: { fontSize: type.bodySm, color: colors.textMuted, marginBottom: 12 },
    input: {
      backgroundColor: colors.backgroundAlt,
      color: colors.text,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      minHeight: 90,
      textAlignVertical: "top",
      fontSize: type.body,
      marginBottom: 12,
    },
    submitBtn: {
      backgroundColor: colors.red,
      borderRadius: radius.sm,
      padding: 14,
      alignItems: "center",
    },
    submitBtnDisabled: { opacity: 0.5 },
    submitText: { color: "#ffffff", fontWeight: "700", fontSize: type.body },
  });
}
