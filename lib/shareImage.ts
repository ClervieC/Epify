import { Platform, Share } from "react-native";
import * as Sharing from "expo-sharing";

// Shares a just-captured PNG (see react-native-view-shot's captureRef in
// app/recap.tsx) as an actual image file, so dropping it into Instagram/X/
// etc. posts a photo instead of a link or plain text. `uri` is whatever
// captureRef returned for the current platform — a local tmpfile:// URI on
// native, a data: URI on web (see RNViewShot.web.js — html2canvas-pro only
// ever produces one of those, never a remote URL).
export async function shareRecapImage(uri: string, fileName: string): Promise<void> {
  if (Platform.OS === "web") {
    await shareImageWeb(uri, fileName);
    return;
  }
  // expo-sharing's local-file support is native-only (its web path only
  // shares a hosted URL, not a local blob/data URI — see its own docs) —
  // exactly why web gets its own branch above instead of sharing this call.
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error("Sharing.isAvailableAsync() returned false");
  await Sharing.shareAsync(uri, { mimeType: "image/png", UTI: "public.png" });
}

async function shareImageWeb(dataUri: string, fileName: string): Promise<void> {
  const res = await fetch(dataUri);
  const blob = await res.blob();
  const file = new File([blob], fileName, { type: "image/png" });

  // Web Share API Level 2 (file sharing) — supported on most mobile
  // browsers (Chrome/Safari on Android/iOS), which is the realistic case
  // for "share to Instagram/etc." on web anyway.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      // The person cancelling the share sheet rejects with AbortError —
      // that's a normal outcome, not a failure to recover from (falling
      // through to a download here would feel like the cancel didn't work).
      if (err instanceof Error && err.name === "AbortError") return;
      // Any other failure (rare) falls through to the download below.
    }
  }

  // Desktop browsers mostly don't support sharing files at all — saving the
  // image locally so the person can attach it to a post themselves is the
  // realistic fallback there, not a dead end.
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}

// The original plain-text share (what Share worked like before image
// sharing existed) — kept as a last-resort fallback for when capturing the
// image itself fails (e.g. a poster still mid-load), so tapping Share never
// just silently does nothing.
export async function shareRecapText(lines: string[]): Promise<void> {
  await Share.share({ message: lines.join("\n") });
}
