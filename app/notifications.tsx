import { useCallback, useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { fetchNotifications, EnrichedNotification } from "../lib/notifications";
import { useNotifications } from "../context/NotificationsContext";
import { shortDate } from "../lib/dates";
import { Avatar } from "../components/Avatar";
import { EmptyState } from "../components/EmptyState";
import { useGoBack } from "../lib/useGoBack";

export default function NotificationsScreen() {
  const router = useRouter();
  const goBack = useGoBack("/(tabs)/profile");
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const [notifications, setNotifications] = useState<EnrichedNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const { markAllRead } = useNotifications();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      fetchNotifications().then((data) => {
        if (!active) return;
        setNotifications(data);
        setLoading(false);
        markAllRead();
      });
      return () => {
        active = false;
      };
    }, [markAllRead])
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t.social.notifications}</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) =>
            item.type === "stale_watchlist" ? (
              <Pressable
                style={styles.row}
                onPress={() => item.tvmaze_show_id && router.push(`/show/${item.tvmaze_show_id}`)}
              >
                {item.show_image ? (
                  <Image source={{ uri: item.show_image }} style={styles.showThumb} />
                ) : (
                  <View style={[styles.showThumb, styles.showThumbPlaceholder]}>
                    <Ionicons name="film-outline" size={18} color={colors.textFaint} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.text}>{t.social.staleWatchlistReminder(item.show_name ?? "")}</Text>
                  <Text style={styles.date}>{shortDate(item.created_at)}</Text>
                </View>
                {!item.read && <View style={styles.unreadDot} />}
              </Pressable>
            ) : (
              <Pressable
                style={styles.row}
                onPress={() => item.actor && router.push({ pathname: "/users/[id]", params: { id: item.actor!.user_id } })}
              >
                <Avatar name={item.actor?.username} imageUri={item.actor?.avatar_url} size="sm" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.text}>
                    <Text style={styles.bold}>{item.actor?.username ?? "?"}</Text> {t.social.startedFollowingYou}
                  </Text>
                  <Text style={styles.date}>{shortDate(item.created_at)}</Text>
                </View>
                {!item.read && <View style={styles.unreadDot} />}
              </Pressable>
            )
          }
          ListEmptyComponent={<EmptyState icon="notifications-outline" title={t.social.noNotifications} />}
        />
      )}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 12,
    },
    title: { fontSize: type.title, fontWeight: "800", color: colors.text },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
    text: { fontSize: type.body, color: colors.text },
    bold: { fontWeight: "800" },
    showThumb: { width: 40, height: 56, borderRadius: radius.sm, backgroundColor: colors.backgroundAlt },
    showThumbPlaceholder: { alignItems: "center", justifyContent: "center" },
    date: { fontSize: type.caption, color: colors.textMuted, marginTop: 2 },
    unreadDot: { width: 8, height: 8, borderRadius: 999, backgroundColor: colors.accent },
  });
}
