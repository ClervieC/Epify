import { useCallback, useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { fetchNotifications, EnrichedNotification } from "../lib/notifications";
import { useNotifications } from "../context/NotificationsContext";
import { acceptRoomInvite, declineRoomInvite } from "../lib/rooms";
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

  async function respondToRoomInvite(item: EnrichedNotification, accept: boolean) {
    if (!item.room_id) return;
    setNotifications((prev) => prev.filter((n) => n.id !== item.id));
    if (accept) {
      await acceptRoomInvite(item.room_id);
      router.push(`/rooms/${item.room_id}`);
    } else {
      await declineRoomInvite(item.room_id);
    }
  }

  function roomShareText(item: EnrichedNotification): string {
    const log = item.roomWatchLog;
    if (!log) return t.rooms.roomSharedGeneric(item.room_name ?? "");
    if (log.content_type === "movie") return t.rooms.roomSharedMovie(log.movie_title ?? "");
    // A season shared in one go (see room_watch_episode_count's own comment
    // in lib/notifications.ts) reads as "marked [Show] Season N watched",
    // not N separate "S2E1"/"S2E2"/... lines — the representative log row
    // still carries the right season either way, just not a meaningful
    // single episode number once there's more than one.
    if (item.room_watch_episode_count > 1 && log.season != null) {
      return t.rooms.roomSharedSeason(item.roomWatchLogShowName ?? "", log.season);
    }
    return t.rooms.roomSharedEpisode(item.roomWatchLogShowName ?? "", `S${log.season}E${log.number}`);
  }

  function openRoomShare(item: EnrichedNotification) {
    const log = item.roomWatchLog;
    if (log?.content_type === "movie" && log.tmdb_id != null) {
      router.push(`/movie/tmdb/${log.tmdb_id}`);
    } else if (log?.content_type === "episode" && item.room_watch_episode_count > 1 && log.tvmaze_show_id != null) {
      router.push(`/show/${log.tvmaze_show_id}`);
    } else if (log?.content_type === "episode" && log.tvmaze_episode_id != null) {
      router.push({ pathname: "/episode/[id]", params: { id: String(log.tvmaze_episode_id), showId: String(log.tvmaze_show_id) } });
    } else if (item.room_id) {
      router.push(`/rooms/${item.room_id}`);
    }
  }

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
            item.type === "room_share" ? (
              <Pressable style={styles.row} onPress={() => openRoomShare(item)}>
                <Avatar name={item.actor?.username} imageUri={item.actor?.avatar_url} size="sm" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.text}>
                    <Text style={styles.bold}>{item.actor?.username ?? "?"}</Text> {roomShareText(item)}
                  </Text>
                  <Text style={styles.date}>{shortDate(item.created_at)}</Text>
                </View>
                {!item.read && <View style={styles.unreadDot} />}
              </Pressable>
            ) : item.type === "room_invite" ? (
              <View style={styles.row}>
                <Avatar name={item.actor?.username} imageUri={item.actor?.avatar_url} size="sm" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.text}>
                    <Text style={styles.bold}>{item.actor?.username ?? "?"}</Text>{" "}
                    {t.rooms.roomInviteText(item.room_name ?? "")}
                  </Text>
                  <Text style={styles.date}>{shortDate(item.created_at)}</Text>
                </View>
                <Pressable
                  style={styles.inviteDecline}
                  onPress={() => respondToRoomInvite(item, false)}
                  accessibilityRole="button"
                  accessibilityLabel={t.rooms.decline}
                >
                  <Text style={styles.inviteDeclineText}>{t.rooms.decline}</Text>
                </Pressable>
                <Pressable
                  style={styles.inviteAccept}
                  onPress={() => respondToRoomInvite(item, true)}
                  accessibilityRole="button"
                  accessibilityLabel={t.rooms.accept}
                >
                  <Text style={styles.inviteAcceptText}>{t.rooms.accept}</Text>
                </Pressable>
              </View>
            ) : item.type === "stale_watchlist" ? (
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
    inviteDecline: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: colors.pillBg },
    inviteDeclineText: { fontSize: type.caption, fontWeight: "700", color: colors.textMuted },
    inviteAccept: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: colors.accent },
    inviteAcceptText: { fontSize: type.caption, fontWeight: "700", color: colors.onAccent },
  });
}
