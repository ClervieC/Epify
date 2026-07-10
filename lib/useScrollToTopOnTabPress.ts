import { useCallback } from "react";
import { useFocusEffect, useNavigation } from "expo-router";

// Re-tapping the tab bar item for the screen you're already on fires a
// "tabPress" event on that screen's own navigation object without actually
// navigating (see app/(tabs)/_layout.tsx's CustomTabBar, which
// preventDefault()s the navigation in that case) — every tab screen listens
// for it here to scroll back to top, the same behavior most feed-style apps
// have. Same underlying pattern app/(tabs)/explore.tsx's search-clear-on-
// retap already used before this was extracted out for reuse.
export function useScrollToTopOnTabPress(onPress: () => void) {
  const navigation = useNavigation();
  useFocusEffect(
    useCallback(() => {
      const unsubscribe = (navigation as any).addListener("tabPress", onPress);
      return unsubscribe;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigation])
  );
}
