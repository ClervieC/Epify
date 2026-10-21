import { useCallback, useMemo, useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, Image, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";
import {
  fetchRoom,
  inviteToRoom,
  leaveRoom,
  deleteRoom,
  updateRoom,
  removeMember,
  fetchGroupedRoomWatchLog,
  fetchLinkedShowProgress,
  RoomWithMembers,
  RoomWatchGroup,
  LinkedShowProgress,
  RoomExpiry,
} from "../../lib/rooms";
import { searchProfiles, Profile } from "../../lib/profiles";
import { getCurrentUserId } from "../../lib/supabase";
import { UserRow } from "../../components/UserRow";
import { Avatar } from "../../components/Avatar";
import { RoomBadge } from "../../components/RoomBadge";
import { RoomFormFields, ExpiryChoice, LinkedShowChoice } from "../../components/RoomFormFields";
import { AddWatchTogetherSheet } from "../../components/AddWatchTogetherSheet";
import { Sheet } from "../../components/Sheet";
import { ChoiceDialog } from "../../components/ChoiceDialog";
import { useGoBack } from "../../lib/useGoBack";

export default function RoomDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const goBack = useGoBack("/rooms");
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t, language } = useLanguage();
  const [room, setRoom] = useState<RoomWithMembers | null>(null);
  const [watchLog, setWatchLog] = useState<RoomWatchGroup[]>([]);
  const [linkedProgress, setLinkedProgress] = useState<LinkedShowProgress | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [inviteQuery, setInviteQuery] = useState("");
  const [inviteResults, setInviteResults] = useState<Profile[]>([]);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ user_id: string; username: string } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmoji, setEditEmoji] = useState<string | null>(null);
  const [editExpiryChoice, setEditExpiryChoice] = useState<ExpiryChoice>("none");
  const [editDays, setEditDays] = useState("");
  const [editShowQuery, setEditShowQuery] = useState("");
  const [editSelectedShow, setEditSelectedShow] = useState<LinkedShowChoice | null>(null);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getCurrentUserId().then((uid) => active && setMyUserId(uid ?? null));
      fetchRoom(id).then((data) => {
        if (!active) return;
        setRoom(data);
        if (data) fetchLinkedShowProgress(data).then((p) => active && setLinkedProgress(p));
      });
      fetchGroupedRoomWatchLog(id).then((data) => active && setWatchLog(data));
      return () => {
        active = false;
      };
    }, [id])
  );

  function onInviteQueryChange(text: string) {
    setInviteQuery(text);
    if (!text.trim()) {
      setInviteResults([]);
      return;
    }
    searchProfiles(text.trim()).then((results) => {
      const memberIds = new Set((room?.members ?? []).map((m) => m.user_id));
      setInviteResults(results.filter((p) => !memberIds.has(p.user_id)));
    });
  }

  async function handleInvite(profile: Profile) {
    await inviteToRoom(id, profile.user_id);
    setInviteQuery("");
    setInviteResults([]);
    const fresh = await fetchRoom(id);
    setRoom(fresh);
  }

  async function handleLeave() {
    setLeaveConfirm(false);
    await leaveRoom(id);
    router.replace("/rooms");
  }

  async function handleDelete() {
    setDeleteConfirm(false);
    await deleteRoom(id);
    router.replace("/rooms");
  }

  function openEdit() {
    if (!room) return;
    setEditName(room.name);
    setEditEmoji(room.emoji);
    setEditExpiryChoice(room.expires_at ? "days" : "none");
    setEditDays(
      room.expires_at ? String(Math.max(1, Math.ceil((new Date(room.expires_at).getTime() - Date.now()) / 86400000))) : "",
    );
    setEditSelectedShow(linkedProgress ? { id: linkedProgress.show.id, name: linkedProgress.show.name, imageUrl: linkedProgress.show.imageUrl } : null);
    setEditShowQuery(linkedProgress?.show.name ?? "");
    setEditOpen(true);
  }

  const canSaveEdit = editName.trim().length > 0 && (editExpiryChoice !== "days" || /^\d+$/.test(editDays.trim()));

  async function handleSaveEdit() {
    if (!canSaveEdit) return;
    setSaving(true);
    try {
      const expiry: RoomExpiry = editExpiryChoice === "days" ? { kind: "days", days: Number(editDays.trim()) } : { kind: "none" };
      await updateRoom(id, editName.trim(), expiry, editEmoji, editSelectedShow?.id ?? null);
      setEditOpen(false);
      const fresh = await fetchRoom(id);
      setRoom(fresh);
      if (fresh) fetchLinkedShowProgress(fresh).then(setLinkedProgress);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveMember() {
    if (!removeTarget) return;
    const target = removeTarget;
    setRemoveTarget(null);
    await removeMember(id, target.user_id);
    const fresh = await fetchRoom(id);
    setRoom(fresh);
    // Otherwise "Currently watching" kept showing the removed member's
    // progress row — it's derived from room.members at the time it was
    // fetched, not live, same as handleSaveEdit already has to re-fetch it.
    if (fresh) fetchLinkedShowProgress(fresh).then(setLinkedProgress);
  }

  // After AddWatchTogetherSheet marks something watched for the room — room
  // membership itself didn't change, just what's been watched together, so
  // only the log (and the linked show's progress, if this touched it) need
  // a fresh fetch, not the room/members.
  function refreshAfterAdd() {
    fetchGroupedRoomWatchLog(id).then(setWatchLog);
    if (room) fetchLinkedShowProgress(room).then(setLinkedProgress);
  }

  if (!room) return <View style={styles.container} />;

  const isOwner = myUserId === room.owner_id;
  const accepted = room.members.filter((m) => m.status === "accepted");
  const pending = room.members.filter((m) => m.status === "invited");
  const expired = !!room.expires_at && new Date(room.expires_at).getTime() <= Date.now();
  const expiryText = room.expires_at
    ? `${expired ? t.rooms.expired : t.rooms.expiresIn(
        new Date(room.expires_at).toLocaleDateString(language === "fr" ? "fr-FR" : "en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      )}`
    : t.rooms.expiryNone;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.titleRow}>
          <RoomBadge name={room.name} emoji={room.emoji} size={28} />
          <Text style={styles.title} numberOfLines={1}>
            {room.name}
          </Text>
        </View>
        {isOwner ? (
          <Pressable onPress={openEdit} hitSlop={10} accessibilityRole="button" accessibilityLabel={t.rooms.editRoom}>
            <Ionicons name="pencil-outline" size={20} color={colors.text} />
          </Pressable>
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      <ScrollView>
        <View style={styles.body}>
          <Text style={styles.expiryText}>{expiryText}</Text>

          {linkedProgress && (
            <>
              <Text style={styles.sectionLabel}>{t.rooms.currentlyWatching}</Text>
              <Pressable style={styles.watchRow} onPress={() => router.push(`/show/${linkedProgress.show.id}`)}>
                {linkedProgress.show.imageUrl ? (
                  <Image source={{ uri: linkedProgress.show.imageUrl }} style={styles.watchThumb} />
                ) : (
                  <View style={[styles.watchThumb, styles.watchThumbPlaceholder]}>
                    <Ionicons name="tv-outline" size={18} color={colors.textFaint} />
                  </View>
                )}
                <Text style={styles.watchTitle} numberOfLines={1}>
                  {linkedProgress.show.name}
                </Text>
              </Pressable>
              {linkedProgress.memberProgress.map((m) => (
                <View key={m.user_id} style={styles.progressRow}>
                  <Avatar name={m.username} imageUri={m.avatar_url} size="sm" />
                  <Text style={styles.progressName} numberOfLines={1}>
                    {m.username}
                  </Text>
                  <Text style={styles.progressCount}>
                    {m.watchedCount}/{linkedProgress.totalEpisodes}
                  </Text>
                </View>
              ))}
            </>
          )}

          <View style={styles.sectionLabelRow}>
            <Text style={styles.sectionLabel}>{t.rooms.watchedTogether}</Text>
            <Pressable
              onPress={() => setAddOpen(true)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t.rooms.addWatchedTitle}
            >
              <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
            </Pressable>
          </View>
          {watchLog.length === 0 ? (
            <Text style={styles.emptyText}>{t.rooms.noWatchedTogether}</Text>
          ) : (
            watchLog.map((g) => (
              <Pressable
                key={g.key}
                style={styles.watchRow}
                onPress={() => router.push(g.kind === "show" ? `/show/${g.tvmazeShowId}` : `/movie/tmdb/${g.tmdbId}`)}
              >
                {g.imageUrl ? (
                  <Image source={{ uri: g.imageUrl }} style={styles.watchThumb} />
                ) : (
                  <View style={[styles.watchThumb, styles.watchThumbPlaceholder]}>
                    <Ionicons name={g.kind === "show" ? "tv-outline" : "film-outline"} size={18} color={colors.textFaint} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.watchTitle} numberOfLines={1}>
                    {g.title}
                  </Text>
                  <Text style={styles.watchSubtitle}>
                    {g.kind === "show" ? t.rooms.episodesTogetherCount(g.episodeCount) : t.rooms.movieTogetherCount(g.episodeCount)}
                  </Text>
                </View>
              </Pressable>
            ))
          )}

            <Text style={styles.sectionLabel}>{t.rooms.members}</Text>
            {accepted.map((m) => (
              <UserRow
                key={m.user_id}
                username={m.profile?.username ?? "?"}
                imageUri={m.profile?.avatar_url}
                onPress={() => router.push({ pathname: "/users/[id]", params: { id: m.user_id } })}
                trailing={
                  isOwner && m.user_id !== myUserId ? (
                    <Pressable
                      onPress={() => setRemoveTarget({ user_id: m.user_id, username: m.profile?.username ?? "?" })}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={t.rooms.removeMember}
                    >
                      <Ionicons name="close-circle-outline" size={20} color={colors.textFaint} />
                    </Pressable>
                  ) : undefined
                }
              />
            ))}

            {pending.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>{t.rooms.pendingInvites}</Text>
                {pending.map((m) => (
                  <UserRow
                    key={m.user_id}
                    username={m.profile?.username ?? "?"}
                    imageUri={m.profile?.avatar_url}
                    subtitle={t.rooms.invited}
                    onPress={() => router.push({ pathname: "/users/[id]", params: { id: m.user_id } })}
                  />
                ))}
              </>
            )}

            {isOwner && (
              <>
                <Text style={styles.sectionLabel}>{t.rooms.invite}</Text>
                <View style={styles.searchBar}>
                  <Ionicons name="search" size={18} color={colors.textFaint} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder={t.rooms.inviteUsernamePlaceholder}
                    placeholderTextColor={colors.textFaint}
                    autoCapitalize="none"
                    textContentType="none"
                    autoComplete="off"
                    importantForAutofill="no"
                    value={inviteQuery}
                    onChangeText={onInviteQueryChange}
                  />
                </View>
                {inviteResults.map((p) => (
                  <UserRow
                    key={p.user_id}
                    username={p.username}
                    imageUri={p.avatar_url}
                    onPress={() => handleInvite(p)}
                    trailing={
                      <Pressable
                        style={styles.inviteBtn}
                        onPress={() => handleInvite(p)}
                        accessibilityRole="button"
                        accessibilityLabel={t.rooms.invite}
                      >
                        <Text style={styles.inviteBtnText}>{t.rooms.invite}</Text>
                      </Pressable>
                    }
                  />
                ))}
              </>
            )}

            <Pressable
              style={styles.dangerRow}
              onPress={() => (isOwner ? setDeleteConfirm(true) : setLeaveConfirm(true))}
              accessibilityRole="button"
            >
              <Ionicons name="exit-outline" size={18} color={colors.red} />
              <Text style={styles.dangerText}>{isOwner ? t.rooms.deleteRoom : t.rooms.leaveRoom}</Text>
            </Pressable>
          </View>
      </ScrollView>

      <ChoiceDialog
        visible={leaveConfirm}
        title={t.rooms.leaveRoom}
        subtitle={t.rooms.leaveRoomConfirm}
        options={[
          { value: "cancel", label: t.rooms.decline },
          { value: "leave", label: t.rooms.leaveRoom, primary: true },
        ]}
        onChoose={(v) => (v === "leave" ? handleLeave() : setLeaveConfirm(false))}
        onDismiss={() => setLeaveConfirm(false)}
      />
      <ChoiceDialog
        visible={deleteConfirm}
        title={t.rooms.deleteRoom}
        subtitle={t.rooms.deleteRoomConfirm}
        options={[
          { value: "cancel", label: t.rooms.decline },
          { value: "delete", label: t.rooms.deleteRoom, primary: true },
        ]}
        onChoose={(v) => (v === "delete" ? handleDelete() : setDeleteConfirm(false))}
        onDismiss={() => setDeleteConfirm(false)}
      />
      <ChoiceDialog
        visible={!!removeTarget}
        title={t.rooms.removeMember}
        subtitle={t.rooms.removeMemberConfirm(removeTarget?.username ?? "")}
        options={[
          { value: "cancel", label: t.rooms.decline },
          { value: "remove", label: t.rooms.removeMember, primary: true },
        ]}
        onChoose={(v) => (v === "remove" ? handleRemoveMember() : setRemoveTarget(null))}
        onDismiss={() => setRemoveTarget(null)}
      />

      <Sheet visible={editOpen} onClose={() => setEditOpen(false)}>
        <Text style={styles.sheetTitle}>{t.rooms.editRoom}</Text>
        <RoomFormFields
          name={editName}
          onNameChange={setEditName}
          emoji={editEmoji}
          onEmojiChange={setEditEmoji}
          expiryChoice={editExpiryChoice}
          onExpiryChoiceChange={setEditExpiryChoice}
          days={editDays}
          onDaysChange={setEditDays}
          showQuery={editShowQuery}
          onShowQueryChange={setEditShowQuery}
          selectedShow={editSelectedShow}
          onSelectShow={(show) => {
            setEditSelectedShow(show);
            setEditShowQuery(show.name);
          }}
          onClearShow={() => {
            setEditSelectedShow(null);
            setEditShowQuery("");
          }}
        />
        <Pressable
          style={[styles.saveBtn, !canSaveEdit && styles.saveBtnDisabled]}
          disabled={!canSaveEdit || saving}
          onPress={handleSaveEdit}
          accessibilityRole="button"
          accessibilityLabel={t.rooms.saveChanges}
        >
          <Text style={styles.saveBtnText}>{t.rooms.saveChanges}</Text>
        </Pressable>
      </Sheet>

      <Sheet visible={addOpen} onClose={() => setAddOpen(false)}>
        <AddWatchTogetherSheet
          roomId={id}
          otherMemberUserIds={accepted.filter((m) => m.user_id !== myUserId).map((m) => m.user_id)}
          onAdded={refreshAfterAdd}
          onClose={() => setAddOpen(false)}
        />
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
    titleRow: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
    title: { flexShrink: 1, textAlign: "center", fontSize: type.title, fontWeight: "800", color: colors.text },
    body: { paddingHorizontal: 16, paddingBottom: 32 },
    expiryText: { fontSize: type.caption, color: colors.textMuted, marginBottom: 16 },
    sectionLabel: { fontWeight: "800", fontSize: type.caption, color: colors.textMuted, marginTop: 16, marginBottom: 4 },
    sectionLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    emptyText: { fontSize: type.caption, color: colors.textFaint, paddingVertical: 4 },
    watchRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
    watchThumb: { width: 40, height: 56, borderRadius: radius.sm, backgroundColor: colors.backgroundAlt },
    watchThumbPlaceholder: { alignItems: "center", justifyContent: "center" },
    watchTitle: { fontWeight: "700", fontSize: type.body, color: colors.text },
    watchSubtitle: { fontSize: type.caption, color: colors.textMuted, marginTop: 2 },
    progressRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
    progressName: { flex: 1, fontWeight: "700", fontSize: type.body, color: colors.text },
    progressCount: { fontSize: type.caption, fontWeight: "700", color: colors.textMuted },
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.backgroundAlt,
      borderRadius: radius.sm,
      marginBottom: 4,
    },
    searchInput: { flex: 1, fontSize: type.input, color: colors.text },
    inviteBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.accent },
    inviteBtnText: { fontSize: type.caption, fontWeight: "700", color: colors.onAccent },
    dangerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 24, paddingVertical: 10 },
    dangerText: { fontSize: type.body, fontWeight: "700", color: colors.red },
    sheetTitle: { textAlign: "center", fontWeight: "800", fontSize: 13, color: colors.textMuted, letterSpacing: 0.5, marginBottom: 16 },
    saveBtn: {
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
      paddingVertical: 15,
      alignItems: "center",
      marginTop: 8,
    },
    saveBtnDisabled: { opacity: 0.5 },
    saveBtnText: { color: colors.onAccent, fontWeight: "800", fontSize: type.body },
  });
}
