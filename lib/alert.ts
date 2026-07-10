import { Alert, Platform } from "react-native";

interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
}

// react-native-web's Alert.alert is a total no-op (see
// node_modules/react-native-web/dist/exports/Alert/index.js — the whole
// implementation is `static alert() {}`), so every plain `Alert.alert(...)`
// call in this app was silently doing nothing on web: no error messages, no
// success confirmations, no destructive-action confirmations. This wraps it
// with a web fallback (window.alert/window.confirm) so the same call sites
// work on both platforms — swap `Alert.alert` for this `alert` everywhere
// in the app.
export function alert(title: string, message?: string, buttons?: AlertButton[]) {
  if (Platform.OS !== "web") {
    Alert.alert(title, message, buttons);
    return;
  }

  const text = message ? `${title}\n\n${message}` : title;

  // A single (or no) button is an informational alert — window.alert has no
  // concept of multiple buttons, so anything more than one is treated as a
  // confirm/cancel choice instead (the shape every multi-button call in
  // this app actually uses — see app/(tabs)/profile.tsx's delete-account
  // confirmation).
  if (!buttons || buttons.length <= 1) {
    window.alert(text);
    buttons?.[0]?.onPress?.();
    return;
  }

  const cancelButton = buttons.find((b) => b.style === "cancel");
  const actionButton = buttons.find((b) => b.style !== "cancel") ?? buttons[0];
  if (window.confirm(text)) {
    actionButton.onPress?.();
  } else {
    cancelButton?.onPress?.();
  }
}
