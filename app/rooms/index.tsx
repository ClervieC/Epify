import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, StyleSheet } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";
import { fetchMyRooms, createRoom, acceptRoomInvite, declineRoomInvite, RoomWithMembers, RoomExpiry } from "../../lib/rooms";
import { getCurrentUserId } from "../../lib/supabase";
import { RoomBadge } from "../../components/RoomBadge";
import { RoomFormFields, ExpiryChoice, LinkedShowChoice } from "../../components/RoomFormFields";
import { Sheet } from "../../components/Sheet";
import { EmptyState } from "../../components/EmptyState";
import { useGoBack } from "../../lib/useGoBack";
import { alert } from "../../lib/alert";

export default function RoomsScreen() {
  const router = useRouter();
  const goBack = useGoBack("/(tabs)/activity");
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t, language } = useLanguage();
  const [rooms, setRooms] = useState<RoomWithMembers[]>([]);
  const [loading, setLoading] = useState(true);
  const [myId, setMyId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [expiryChoice, setExpiryChoice] = useState<ExpiryChoice>("none");
  const [days, setDays] = useState("");
  const [showQuery, setShowQuery] = useState("");
  const [selectedShow, setSelectedShow] = useState<LinkedShowChoice | null>(null);
  const [emoji, setEmoji] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    getCurrentUserId().then((id) => setMyId(id ?? null));
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      fetchMyRooms().then((data) => {
        if (active) {
          setRooms(data);
          setLoading(false);
        }
      });
      return () => {
        active = false;
      };
    }, [])
  );

  // Lets a pending invite be accepted/declined right from this list (see
  // app/notifications.tsx for the other entry point to the same actions).
  // Re-fetches the whole list from Supabase afterward rather than patching
  // local state in place — an earlier version did the latter (flip this
  // one member's status to "accepted" in place) and it looked right in
  // testing, but a real device still showed the row as pending after
  // accepting it even though the database row genuinely was 'accepted'
  // (confirmed directly via psql) — a refetch sidesteps whatever stale-
  // closure/render-timing issue caused that mismatch by always rendering
  // whatever the server actually has, same as this screen already does on
  // every normal focus.
  async function respondInvite(room: RoomWithMembers, accept: boolean) {
    try {
      if (accept) {
        await acceptRoomInvite(room.id);
      } else {
        await declineRoomInvite(room.id);
      }
      const fresh = await fetchMyRooms();
      setRooms(fresh);
    } catch {
      alert(t.rooms.title, t.rooms.respondInviteFailed);
    }
  }

  function openCreate() {
    setName("");
    setExpiryChoice("none");
    setDays("");
    setShowQuery("");
    setSelectedShow(null);
    setEmoji(null);
    setCreateOpen(true);
  }

  const canCreate = name.trim().length > 0 && (expiryChoice !== "days" || /^\d+$/.test(days.trim()));

  async function handleCreate() {
    if (!canCreate) return;
    setCreating(true);
    try {
      const expiry: RoomExpiry = expiryChoice === "days" ? { kind: "days", days: Number(days.trim()) } : { kind: "none" };
      const room = await createRoom(name.trim(), expiry, emoji, selectedShow?.id ?? null);
      setCreateOpen(false);
      router.push(`/rooms/${room.id}`);
    } finally {
      setCreating(false);
    }
  }

  function expiryLabel(room: RoomWithMembers): string | null {
    if (!room.expires_at) return null;
    const expired = new Date(room.expires_at).getTime() <= Date.now();
    if (expired) return t.rooms.expired;
    const date = new Date(room.expires_at).toLocaleDateString(language === "fr" ? "fr-FR" : "en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return t.rooms.expiresIn(date);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{t.rooms.title}</Text>
        <Pressable onPress={openCreate} hitSlop={10} accessibilityRole="button" accessibilityLabel={t.rooms.newRoom}>
          <Ionicons name="add-circle-outline" size={26} color={colors.accent} />
        </Pressable>
      </View>

      {!loading && (
        <FlatList
          data={rooms}
          keyExtractor={(item) => item.id}
          contentContainerStyle={rooms.length === 0 ? styles.emptyContainer : undefined}
          renderItem={({ item }) => {
            const members = item.members.filter((m) => m.status === "accepted");
            const expiry = expiryLabel(item);
            const myMembership = item.members.find((m) => m.user_id === myId);

            if (myMembership?.status === "invited") {
              return (
                <View style={styles.row}>
                  <RoomBadge name={item.name} emoji={item.emoji} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.roomName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.roomSubtitle} numberOfLines={1}>
                      {t.rooms.invited}
                    </Text>
                  </View>
                  <Pressable
                    style={styles.inviteDecline}
                    onPress={() => respondInvite(item, false)}
                    accessibilityRole="button"
                    accessibilityLabel={t.rooms.decline}
                  >
                    <Text style={styles.inviteDeclineText}>{t.rooms.decline}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.inviteAccept}
                    onPress={() => respondInvite(item, true)}
                    accessibilityRole="button"
                    accessibilityLabel={t.rooms.accept}
                  >
                    <Text style={styles.inviteAcceptText}>{t.rooms.accept}</Text>
                  </Pressable>
                </View>
              );
            }

            return (
              <Pressable style={styles.row} onPress={() => router.push(`/rooms/${item.id}`)}>
                <RoomBadge name={item.name} emoji={item.emoji} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.roomName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.roomSubtitle} numberOfLines={1}>
                    {t.rooms.members} · {members.length}
                    {expiry ? ` · ${expiry}` : ""}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <EmptyState icon="people-circle-outline" title={t.rooms.noRooms} subtitle={t.rooms.noRoomsDesc} />
          }
        />
      )}

      <Sheet visible={createOpen} onClose={() => setCreateOpen(false)}>
        <Text style={styles.sheetTitle}>{t.rooms.createRoom}</Text>
        <RoomFormFields
          name={name}
          onNameChange={setName}
          emoji={emoji}
          onEmojiChange={setEmoji}
          expiryChoice={expiryChoice}
          onExpiryChoiceChange={setExpiryChoice}
          days={days}
          onDaysChange={setDays}
          showQuery={showQuery}
          onShowQueryChange={setShowQuery}
          selectedShow={selectedShow}
          onSelectShow={(show) => {
            setSelectedShow(show);
            setShowQuery(show.name);
          }}
          onClearShow={() => {
            setSelectedShow(null);
            setShowQuery("");
          }}
        />

        <Pressable
          style={[styles.createBtn, !canCreate && styles.createBtnDisabled]}
          disabled={!canCreate || creating}
          onPress={handleCreate}
          accessibilityRole="button"
          accessibilityLabel={t.rooms.createRoom}
        >
          <Text style={styles.createBtnText}>{t.rooms.createRoom}</Text>
        </Pressable>
      </Sheet>
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
    emptyContainer: { flexGrow: 1 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 16,
    },
    roomName: { fontWeight: "800", fontSize: type.body, color: colors.text },
    roomSubtitle: { fontSize: type.caption, color: colors.textMuted, marginTop: 2 },
    inviteDecline: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: colors.pillBg },
    inviteDeclineText: { fontSize: type.caption, fontWeight: "700", color: colors.textMuted },
    inviteAccept: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: colors.accent },
    inviteAcceptText: { fontSize: type.caption, fontWeight: "700", color: colors.onAccent },
    sheetTitle: { textAlign: "center", fontWeight: "800", fontSize: 13, color: colors.textMuted, letterSpacing: 0.5, marginBottom: 16 },
    createBtn: {
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
      paddingVertical: 15,
      alignItems: "center",
      marginTop: 8,
    },
    createBtnDisabled: { opacity: 0.5 },
    createBtnText: { color: colors.onAccent, fontWeight: "800", fontSize: type.body },
  });
}
