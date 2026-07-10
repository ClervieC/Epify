import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNetwork } from "../context/NetworkContext";
import { useColors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";

// A thin persistent strip rather than a dismissible toast — connectivity is
// ongoing state, not a one-off event, and every screen's own loading/error
// handling already assumes a fetch might fail; this just tells the user why
// up front instead of them seeing several unrelated screens quietly stall or
// show stale data with no explanation.
export function OfflineBanner() {
  const { isOffline } = useNetwork();
  const colors = useColors();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  if (!isOffline) return null;

  return (
    <View style={[styles.banner, { backgroundColor: colors.red, paddingTop: insets.top + 6 }]}>
      <Ionicons name="cloud-offline-outline" size={14} color="#ffffff" />
      <Text style={styles.text}>{t.common.offline}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingBottom: 6,
    zIndex: 200,
  },
  text: { color: "#ffffff", fontSize: 12, fontWeight: "700" },
});
