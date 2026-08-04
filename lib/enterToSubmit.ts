import { Platform } from "react-native";
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from "react-native";

// TextInput's onKeyPress prop, wired so a multiline message/comment box
// behaves like every other chat app: Enter sends, Shift+Enter inserts a
// newline. Only meaningful on web — react-native-web forwards the raw DOM
// KeyboardEvent here, so `shiftKey`/`isComposing`/`preventDefault` are all
// actually available despite RN's own TextInputKeyPressEventData type only
// declaring `key`. Native platforms have no Shift key on a soft keyboard, so
// their return key is left doing what it already does on a multiline field
// (insert a newline) — this is a no-op there.
export function enterToSubmit(onSubmit: () => void) {
  if (Platform.OS !== "web") return undefined;
  return (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const event = e as unknown as {
      key: string;
      shiftKey?: boolean;
      // Guards IME composition (e.g. Japanese/Chinese input) — Enter there
      // confirms the current candidate, not "send".
      isComposing?: boolean;
      preventDefault?: () => void;
    };
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault?.();
      onSubmit();
    }
  };
}
