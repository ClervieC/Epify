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
    input.style.display = "none";
    input.addEventListener("change", () => {
      const files = input.files ? Array.from(input.files).slice(0, maxCount) : [];
      resolve(files.map((f) => ({ uri: URL.createObjectURL(f), mimeType: f.type || "image/jpeg" })));
      document.body.removeChild(input);
    });
    document.body.appendChild(input);
    input.click();
  });
}
