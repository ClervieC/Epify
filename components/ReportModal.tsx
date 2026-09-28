import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { Image } from "expo-image";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import { Sheet } from "./Sheet";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { createReport, uploadReportImage, CreateReportParams, MAX_REPORT_IMAGES } from "../lib/reports";
import { alert } from "../lib/alert";
import { mapWithConcurrency } from "../lib/concurrency";

interface ReportModalProps {
  visible: boolean;
  onClose: () => void;
  // Everything the report needs except `reason`, which this collects —
  // callers pass whichever target_* field applies (see lib/reports.ts).
  target: Omit<CreateReportParams, "reason">;
}

interface PickedImage {
  uri: string;
  mimeType: string;
}

// One shared reason-entry sheet for every reportable thing (a user, a
// comment, a show/episode/movie) rather than five near-identical modals —
// call sites only differ in which `target` they pass in.
export function ReportModal({ visible, onClose, target }: ReportModalProps) {
  const colors = useColors();
  const styles = useStyles(colors);
  const { t } = useLanguage();
  const [reason, setReason] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function handleAddPhoto() {
    const remaining = MAX_REPORT_IMAGES - images.length;
    if (remaining <= 0) return;
    const result = await DocumentPicker.getDocumentAsync({
      type: "image/*",
      copyToCacheDirectory: true,
      multiple: remaining > 1,
    });
    if (result.canceled) return;
    setImages((prev) => [
      ...prev,
      ...result.assets.slice(0, remaining).map((a) => ({ uri: a.uri, mimeType: a.mimeType ?? "image/jpeg" })),
    ]);
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  function reset() {
    setReason("");
    setImages([]);
  }

  async function handleSubmit() {
    if (!reason.trim()) return;
    setSubmitting(true);
    try {
      // Uploaded before the report row exists — createReport just wants the
      // resulting public URLs, not a live reference back to any local file.
      // Kept in its own try/catch so a failure here gets its own, more
      // specific message instead of the generic "couldn't submit report"
      // one below — and any single upload failing aborts the whole
      // submission rather than filing a report silently missing evidence
      // the user thought they'd attached.
      let imageUrls: string[];
      try {
        imageUrls = await mapWithConcurrency(images, 3, (img, i) => uploadReportImage(img.uri, img.mimeType, i));
      } catch {
        alert(t.report.photoUploadFailedTitle, t.report.photoUploadFailedMessage);
        return;
      }
      await createReport({ ...target, reason, imageUrls });
      reset();
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

      {images.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow} contentContainerStyle={styles.photoRowContent}>
          {images.map((img, i) => (
            <View key={img.uri + i} style={styles.thumbWrap}>
              <Image source={{ uri: img.uri }} style={styles.thumb} contentFit="cover" />
              <Pressable
                style={styles.removeBtn}
                onPress={() => removeImage(i)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t.report.removePhoto}
              >
                <Ionicons name="close-circle" size={20} color={colors.red} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      <Pressable
        style={[styles.addPhotoBtn, images.length >= MAX_REPORT_IMAGES && styles.addPhotoBtnDisabled]}
        onPress={handleAddPhoto}
        disabled={images.length >= MAX_REPORT_IMAGES}
        accessibilityRole="button"
        accessibilityLabel={t.report.addPhoto}
      >
        <Ionicons name="image-outline" size={16} color={colors.accent} />
        <Text style={styles.addPhotoText}>{t.report.addPhoto}</Text>
        <Text style={styles.photoCount}>{t.report.photoCount(images.length, MAX_REPORT_IMAGES)}</Text>
      </Pressable>

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
      // 16px, not type.body's 14 — anything smaller makes iOS Safari
      // auto-zoom the whole page on focus.
      fontSize: type.input,
      marginBottom: 12,
    },
    photoRow: { marginBottom: 12 },
    photoRowContent: { gap: 8 },
    thumbWrap: { position: "relative" },
    thumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.backgroundAlt },
    removeBtn: {
      position: "absolute",
      top: -6,
      right: -6,
      backgroundColor: colors.surface,
      borderRadius: 999,
    },
    addPhotoBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      alignSelf: "flex-start",
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 12,
    },
    addPhotoBtnDisabled: { opacity: 0.5 },
    addPhotoText: { color: colors.accent, fontWeight: "700", fontSize: type.bodySm },
    photoCount: { color: colors.textFaint, fontSize: type.caption, marginLeft: 2 },
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
