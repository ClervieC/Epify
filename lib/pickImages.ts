import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";

export interface PickedImageFile {
  uri: string;
  mimeType: string;
}

// expo-document-picker's own web implementation opens the file input via
// input.dispatchEvent(new MouseEvent("click")) rather than calling
// input.click() — Safari (including iOS standalone/PWA, where both the
// report-photo and avatar pickers were silently doing nothing) only honors
// a real .click() as user-activated, so that picker never opened there.
// Native platforms don't have this problem, so only web gets its own
// minimal implementation; everywhere else keeps using DocumentPicker.
export async function pickImages(maxCount: number): Promise<PickedImageFile[]> {
  if (Platform.OS !== "web") {
    const result = await DocumentPicker.getDocumentAsync({
      type: "image/*",
      copyToCacheDirectory: true,
      multiple: maxCount > 1,
    });
    if (result.canceled) return [];
    return result.assets.slice(0, maxCount).map((a) => ({ uri: a.uri, mimeType: a.mimeType ?? "image/jpeg" }));
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = maxCount > 1;
    // NOT display:none — iOS Safari doesn't reliably open the native file
    // picker for a display:none input even with a real .click() call (this
    // was still broken after switching away from expo-document-picker's
    // dispatchEvent approach, for exactly this reason). Positioned off-
    // screen and invisible instead, which keeps it both present in the
    // layout (so Safari treats the click as going to a real, visible-ish
    // element) and inert for everything else.
    Object.assign(input.style, {
      position: "fixed",
      top: "-1000px",
      left: "-1000px",
      width: "1px",
      height: "1px",
      opacity: "0",
    });

    let settled = false;
    function cleanup() {
      window.removeEventListener("focus", onWindowFocus);
      if (input.parentNode) document.body.removeChild(input);
    }
    function finish(files: PickedImageFile[]) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(files);
    }

    input.addEventListener("change", () => {
      const files = input.files ? Array.from(input.files).slice(0, maxCount) : [];
      finish(files.map((f) => ({ uri: URL.createObjectURL(f), mimeType: f.type || "image/jpeg" })));
    });

    // Safety net: iOS Safari doesn't always fire a 'change' (or 'cancel')
    // event when the picker is dismissed without choosing a file, which
    // would otherwise leave this promise — and the caller awaiting it —
    // hanging forever. The window regaining focus is what reliably happens
    // either way (picker closed, with or without a selection); if a real
    // selection was made, the 'change' listener above has already settled
    // this by the time focus returns, so this fires second and is a no-op.
    function onWindowFocus() {
      setTimeout(() => finish([]), 300);
    }
    window.addEventListener("focus", onWindowFocus);

    document.body.appendChild(input);
    input.click();
  });
}
