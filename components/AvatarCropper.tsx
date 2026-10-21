import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Platform, useWindowDimensions, ViewStyle } from "react-native";
import { Image, ImageLoadEventData } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { captureRef } from "react-native-view-shot";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import type { PickedImageFile } from "../lib/pickImages";

const MAX_ZOOM = 4;
const ZOOM_STEP = 1.4;
// Square side of the uploaded avatar — the biggest Avatar renders at 84px,
// so this stays sharp on 3x screens with room to spare.
const OUTPUT_SIZE = 512;

interface AvatarCropperProps {
  // null = closed.
  uri: string | null;
  onCancel: () => void;
  onConfirm: (cropped: PickedImageFile) => Promise<void>;
}

// Full-screen "move and zoom" step between picking a photo and uploading
// it: the photo fills a square frame with the avatar circle cut out of a
// dimmed overlay, and whatever ends up inside that square is what gets
// uploaded — so the face lands in the circle instead of wherever the
// center of the original photo happened to be.
export function AvatarCropper({ uri, onCancel, onConfirm }: AvatarCropperProps) {
  const colors = useColors();
  const { t } = useLanguage();
  const { width, height } = useWindowDimensions();
  const frame = Math.min(width - 48, height - 260, 340);
  const styles = useMemo(() => createStyles(colors, frame), [colors, frame]);

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const captureViewRef = useRef<View>(null);

  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  // At zoom 1 the photo exactly covers the frame on its short side ("cover"),
  // so there's never an empty strip inside the circle.
  const baseW = natural ? (natural.w * frame) / Math.min(natural.w, natural.h) : frame;
  const baseH = natural ? (natural.h * frame) / Math.min(natural.w, natural.h) : frame;

  useEffect(() => {
    setNatural(null);
    setSaving(false);
    scale.value = 1;
    tx.value = 0;
    ty.value = 0;
  }, [uri, scale, tx, ty]);

  function clampTranslate(value: number, base: number, s: number) {
    "worklet";
    const max = Math.max(0, (base * s - frame) / 2);
    return Math.min(max, Math.max(-max, value));
  }

  const pan = Gesture.Pan()
    .onStart(() => {
      startX.value = tx.value;
      startY.value = ty.value;
    })
    .onUpdate((e) => {
      tx.value = clampTranslate(startX.value + e.translationX, baseW, scale.value);
      ty.value = clampTranslate(startY.value + e.translationY, baseH, scale.value);
    });

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.min(MAX_ZOOM, Math.max(1, startScale.value * e.scale));
      tx.value = clampTranslate(tx.value, baseW, scale.value);
      ty.value = clampTranslate(ty.value, baseH, scale.value);
    });

  const gesture = Gesture.Simultaneous(pan, pinch);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  // Buttons for zoom too — a desktop browser has no pinch.
  function zoomBy(factor: number) {
    const next = Math.min(MAX_ZOOM, Math.max(1, scale.value * factor));
    scale.value = withTiming(next, { duration: 150 });
    tx.value = withTiming(clampTranslate(tx.value, baseW, next), { duration: 150 });
    ty.value = withTiming(clampTranslate(ty.value, baseH, next), { duration: 150 });
  }

  function onLoad(e: ImageLoadEventData) {
    setNatural({ w: e.source.width, h: e.source.height });
  }

  async function save() {
    if (!uri || !natural || saving) return;
    setSaving(true);
    try {
      const cropped =
        Platform.OS === "web"
          ? await cropOnCanvas(uri, natural, frame, scale.value, tx.value, ty.value)
          : {
              // Native: snapshot the frame itself — it only contains the
              // transformed photo (the circle overlay is a sibling outside
              // captureViewRef), i.e. exactly what's in the square.
              uri: await captureRef(captureViewRef, {
                format: "jpg",
                quality: 0.9,
                width: OUTPUT_SIZE,
                height: OUTPUT_SIZE,
              }),
              mimeType: "image/jpeg",
            };
      await onConfirm(cropped);
    } finally {
      setSaving(false);
    }
  }

  if (!uri) return null;

  const content = (
    <View style={styles.backdrop}>
      <GestureHandlerRootView style={styles.root}>
        <Text style={styles.title}>{t.profile.cropTitle}</Text>
        <Text style={styles.hint}>{t.profile.cropHint}</Text>

        <GestureDetector gesture={gesture}>
          <View style={styles.frame}>
            <View ref={captureViewRef} collapsable={false} style={styles.capture}>
              <Animated.View
                // pointerEvents none: on web the photo is a real <img>, and
                // dragging one starts the browser's own image drag-and-drop,
                // which cancels the pan gesture mid-drag. The frame around
                // it receives the touches instead.
                pointerEvents="none"
                style={[
                  {
                    position: "absolute",
                    width: baseW,
                    height: baseH,
                    left: (frame - baseW) / 2,
                    top: (frame - baseH) / 2,
                  },
                  imageStyle,
                ]}
              >
                <Image source={{ uri }} style={{ width: "100%", height: "100%" }} contentFit="fill" onLoad={onLoad} />
              </Animated.View>
            </View>
            {/* Dims the square's corners, leaving the avatar circle clear —
                a ring whose border is thick enough to reach past them. */}
            <View pointerEvents="none" style={styles.mask} />
            <View pointerEvents="none" style={styles.circleOutline} />
            {!natural && <ActivityIndicator style={StyleSheet.absoluteFill} color={colors.onAccent} />}
          </View>
        </GestureDetector>

        <View style={styles.zoomRow}>
          <Pressable
            style={styles.zoomBtn}
            onPress={() => zoomBy(1 / ZOOM_STEP)}
            accessibilityRole="button"
            accessibilityLabel={t.profile.zoomOut}
          >
            <Ionicons name="remove" size={22} color="#fff" />
          </Pressable>
          <Pressable
            style={styles.zoomBtn}
            onPress={() => zoomBy(ZOOM_STEP)}
            accessibilityRole="button"
            accessibilityLabel={t.profile.zoomIn}
          >
            <Ionicons name="add" size={22} color="#fff" />
          </Pressable>
        </View>

        <View style={styles.actions}>
          <Pressable style={styles.cancelBtn} onPress={onCancel} disabled={saving} accessibilityRole="button">
            <Text style={styles.cancelText}>{t.common.cancel}</Text>
          </Pressable>
          <Pressable
            style={[styles.saveBtn, (!natural || saving) && { opacity: 0.6 }]}
            onPress={save}
            disabled={!natural || saving}
            accessibilityRole="button"
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.onAccent} />
            ) : (
              <Text style={styles.saveText}>{t.profile.cropSave}</Text>
            )}
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </View>
  );

  // Same portal reasoning as components/Sheet.tsx — escape any transformed
  // ancestor so position:fixed really covers the viewport.
  return Platform.OS === "web" ? createPortal(content, document.body) : content;
}

// Web: cut the same square out of the full-resolution photo on a canvas —
// html2canvas (what react-native-view-shot uses on web) re-renders the DOM
// and doesn't reliably honor the CSS transforms the frame is made of.
async function cropOnCanvas(
  uri: string,
  natural: { w: number; h: number },
  frame: number,
  s: number,
  tx: number,
  ty: number,
): Promise<PickedImageFile> {
  const img = new window.Image();
  // The stored original (re-cropping) is a public Storage URL on another
  // origin — without this the canvas is tainted and toBlob throws.
  img.crossOrigin = "anonymous";
  img.src = uri;
  await img.decode();

  // Screen pixels per source pixel, then map the frame back into the photo.
  const ratio = (frame / Math.min(natural.w, natural.h)) * s;
  const side = frame / ratio;
  const sx = natural.w / 2 - tx / ratio - side / 2;
  const sy = natural.h / 2 - ty / ratio - side / 2;

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("Canvas export failed");
  return { uri: URL.createObjectURL(blob), mimeType: "image/jpeg" };
}

function createStyles(colors: Colors, frame: number) {
  const ring = frame;
  return StyleSheet.create({
    backdrop: {
      position: Platform.OS === "web" ? "fixed" : "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.92)",
      zIndex: 1000,
    } as ViewStyle,
    root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    title: { fontSize: type.body, fontWeight: "800", color: "#fff" },
    hint: { fontSize: type.caption, color: "rgba(255,255,255,0.7)", marginTop: 4, marginBottom: 20, textAlign: "center" },
    frame: {
      width: frame,
      height: frame,
      overflow: "hidden",
      backgroundColor: "#000",
      // Web: stop the page from scrolling/zooming while dragging the photo.
      ...(Platform.OS === "web" ? ({ touchAction: "none", cursor: "grab" } as object) : null),
    },
    capture: { width: frame, height: frame, overflow: "hidden" },
    mask: {
      position: "absolute",
      width: frame + ring * 2,
      height: frame + ring * 2,
      left: -ring,
      top: -ring,
      borderRadius: frame / 2 + ring,
      borderWidth: ring,
      borderColor: "rgba(0,0,0,0.55)",
    },
    circleOutline: {
      position: "absolute",
      width: frame,
      height: frame,
      borderRadius: frame / 2,
      borderWidth: 2,
      borderColor: "rgba(255,255,255,0.85)",
    },
    zoomRow: { flexDirection: "row", gap: 16, marginTop: 18 },
    zoomBtn: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      backgroundColor: "rgba(255,255,255,0.15)",
      alignItems: "center",
      justifyContent: "center",
    },
    actions: { flexDirection: "row", gap: 12, marginTop: 24, width: frame },
    cancelBtn: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: radius.sm,
      alignItems: "center",
      backgroundColor: "rgba(255,255,255,0.15)",
    },
    cancelText: { fontWeight: "700", fontSize: type.bodySm, color: "#fff" },
    saveBtn: { flex: 1, paddingVertical: 14, borderRadius: radius.sm, alignItems: "center", backgroundColor: colors.accent },
    saveText: { fontWeight: "700", fontSize: type.bodySm, color: colors.onAccent },
  });
}
