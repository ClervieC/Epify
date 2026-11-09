import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, dropShadow, hueForTitle, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";
import {
  fetchRoom,
  inviteToRoom,
  leaveRoom,
  deleteRoom,
  updateRoom,
  removeMember,
  fetchGroupedRoomWatchLog,
  fetchRoomShowsProgress,
  fetchRoomWatchlist,
  removeFromRoomWatchlist,
  unmarkWatchGroupForRoom,
  unmarkEpisodeFromRoom,
  RoomWithMembers,
  RoomWatchGroup,
  RoomWatchLogEntry,
  RoomWatchlistEntry,
  LinkedShowProgress,
  RoomExpiry,
} from "../../lib/rooms";
import { posterUrl } from "../../lib/tmdb";
import { searchProfiles, Profile } from "../../lib/profiles";
import { getCurrentUserId, supabase } from "../../lib/supabase";
import { UserRow } from "../../components/UserRow";
import { Avatar } from "../../components/Avatar";
import { AvatarStack } from "../../components/AvatarStack";
import { Pill } from "../../components/Pill";
import { RoomBadge } from "../../components/RoomBadge";
import { RoomFormFields, ExpiryChoice, LinkedShowChoice } from "../../components/RoomFormFields";
import { AddWatchTogetherSheet } from "../../components/AddWatchTogetherSheet";
import { AddToWatchlistSheet } from "../../components/AddToWatchlistSheet";
import { Sheet } from "../../components/Sheet";
import { ChoiceDialog } from "../../components/ChoiceDialog";
import { HorizontalScrollRow } from "../../components/HorizontalScrollRow";
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
  const [watchlist, setWatchlist] = useState<RoomWatchlistEntry[]>([]);
  const [addToWatchlistOpen, setAddToWatchlistOpen] = useState(false);
  const [showsProgress, setShowsProgress] = useState<LinkedShowProgress[]>([]);
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
  // Movies have no sub-items to expand into (no "episodes"), so they keep
  // the simple whole-group undo. Shows expand into their individual
  // episodes instead (expandedShows) — unwatchTarget here is only ever a
  // movie group now; see unwatchEntryTarget below for a show's per-episode
  // undo.
  const [unwatchTarget, setUnwatchTarget] = useState<RoomWatchGroup | null>(null);
  const [unwatchEntryTarget, setUnwatchEntryTarget] = useState<RoomWatchLogEntry | null>(null);
  // A "Watched together" tile opens its own sheet (the show's episodes, each
  // undoable, or the movie's undo) — keyed rather than holding the group
  // itself so the sheet follows watchLog as episodes get undone.
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  // Both poster sections scroll sideways by default (one row tall however
  // long the list gets); "See all" lays the whole list out as a grid.
  const [watchlistExpanded, setWatchlistExpanded] = useState(false);
  const [watchedExpanded, setWatchedExpanded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      getCurrentUserId().then((uid) => active && setMyUserId(uid ?? null));
      fetchRoom(id).then((data) => {
        if (!active) return;
        setRoom(data);
        if (data) fetchRoomShowsProgress(data).then((p) => active && setShowsProgress(p));
      });
      fetchGroupedRoomWatchLog(id).then((data) => active && setWatchLog(data));
      fetchRoomWatchlist(id).then((data) => active && setWatchlist(data));
      return () => {
        active = false;
      };
    }, [id])
  );

  function refreshWatchlist() {
    fetchRoomWatchlist(id).then(setWatchlist);
  }

  // Live updates from the other members: something added to / removed from
  // "Want to watch together", something marked watched for the room, or
  // someone joining/leaving shows up without reopening the room. The three
  // tables are in the supabase_realtime publication (supabase/schema.sql).
  // A DELETE arrives with only its primary key and can't be filtered by
  // room server-side, so it's matched against what's on screen (refs, so
  // the subscription doesn't restart on every list change).
  const watchlistRef = useRef(watchlist);
  watchlistRef.current = watchlist;
  const watchLogRef = useRef(watchLog);
  watchLogRef.current = watchLog;
  const roomRef = useRef(room);
  roomRef.current = room;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending = { watchlist: false, log: false, members: false };
    // Coalesces a burst (a whole season shared at once = one row each).
    function schedule(part: keyof typeof pending) {
      pending[part] = true;
      if (timer) return;
      timer = setTimeout(async () => {
        timer = null;
        const todo = pending;
        pending = { watchlist: false, log: false, members: false };
        if (todo.watchlist) fetchRoomWatchlist(id).then(setWatchlist).catch(() => {});
        let fresh = roomRef.current;
        if (todo.members) {
          fresh = await fetchRoom(id).catch(() => fresh);
          setRoom(fresh);
        }
        if (todo.log) fetchGroupedRoomWatchLog(id).then(setWatchLog).catch(() => {});
        if ((todo.log || todo.members) && fresh) fetchRoomShowsProgress(fresh).then(setShowsProgress).catch(() => {});
      }, 400);
    }
    type Payload = { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> };
    const filter = `room_id=eq.${id}`;
    const channel = supabase
      .channel(`room:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_watchlist", filter }, (p: Payload) => {
        if (p.eventType === "DELETE" && !watchlistRef.current.some((e) => e.id === p.old?.id)) return;
        schedule("watchlist");
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "room_watch_log", filter }, (p: Payload) => {
        if (p.eventType === "DELETE" && !watchLogRef.current.some((g) => g.entries.some((e) => e.id === p.old?.id))) return;
        schedule("log");
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "room_members", filter }, (p: Payload) => {
        // room_members' primary key is (room_id, user_id), so even a
        // DELETE says which room it was.
        if ((p.new?.room_id ?? p.old?.room_id) !== id) return;
        schedule("members");
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [id]);

  async function handleRemoveFromWatchlist(entryId: string) {
    setWatchlist((prev) => prev.filter((e) => e.id !== entryId));
    await removeFromRoomWatchlist(entryId).catch(() => refreshWatchlist());
  }

  async function handleUnwatchGroup() {
    if (!unwatchTarget) return;
    const target = unwatchTarget;
    setUnwatchTarget(null);
    setOpenGroupKey(null);
    setWatchLog((prev) => prev.filter((g) => g.key !== target.key));
    await unmarkWatchGroupForRoom(id, target).catch(() => fetchGroupedRoomWatchLog(id).then(setWatchLog));
    // Progress shown in "Currently watching" reads from watched_episodes
    // too — stale otherwise if the undone show is one of the ones listed.
    if (room) fetchRoomShowsProgress(room).then(setShowsProgress);
  }

  async function handleUnwatchEntry() {
    if (!unwatchEntryTarget) return;
    const entry = unwatchEntryTarget;
    setUnwatchEntryTarget(null);
    setWatchLog((prev) =>
      prev
        .map((g) => (g.key === `show:${entry.tvmaze_show_id}` ? { ...g, entries: g.entries.filter((e) => e.id !== entry.id), episodeCount: g.episodeCount - 1 } : g))
        .filter((g) => g.episodeCount > 0)
    );
    await unmarkEpisodeFromRoom(id, entry.tvmaze_episode_id!).catch(() => fetchGroupedRoomWatchLog(id).then(setWatchLog));
    if (room) fetchRoomShowsProgress(room).then(setShowsProgress);
  }

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
    const linked = showsProgress.find((p) => p.show.id === room.linked_tvmaze_show_id);
    setEditSelectedShow(linked ? { id: linked.show.id, name: linked.show.name, imageUrl: linked.show.imageUrl } : null);
    setEditShowQuery(linked?.show.name ?? "");
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
      if (fresh) fetchRoomShowsProgress(fresh).then(setShowsProgress);
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
    if (fresh) fetchRoomShowsProgress(fresh).then(setShowsProgress);
  }

  // After AddWatchTogetherSheet marks something watched for the room — room
  // membership itself didn't change, just what's been watched together, so
  // only the log (and the linked show's progress, if this touched it) need
  // a fresh fetch, not the room/members.
  function refreshAfterAdd() {
    fetchGroupedRoomWatchLog(id).then(setWatchLog);
    if (room) fetchRoomShowsProgress(room).then(setShowsProgress);
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

  const heroHue = colors[hueForTitle(room.name)];

  // Finished shows (everyone has seen every aired episode) drop out — they
  // already live on in "Watched together" below.
  const inProgress = showsProgress.filter((p) => !p.finished);

  function renderShowProgress(p: LinkedShowProgress, compact: boolean) {
    const myWatchedCount = p.memberProgress.find((m) => m.user_id === myUserId)?.watchedCount ?? 0;
    return (
      <>
        <Pressable style={styles.watchRow} onPress={() => router.push(`/show/${p.show.id}`)}>
          {p.show.imageUrl ? (
            <Image source={{ uri: p.show.imageUrl }} style={compact ? styles.watchThumbSmall : styles.watchThumb} />
          ) : (
            <View style={[compact ? styles.watchThumbSmall : styles.watchThumb, styles.watchThumbPlaceholder]}>
              <Ionicons name="tv-outline" size={18} color={colors.textFaint} />
            </View>
          )}
          <Text style={[styles.watchTitle, { flex: 1 }]} numberOfLines={compact ? 2 : 1}>
            {p.show.name}
          </Text>
        </Pressable>
        {p.memberProgress.map((m) => {
          const pct = p.totalEpisodes > 0 ? Math.min(100, (m.watchedCount / p.totalEpisodes) * 100) : 0;
          // Flagged once someone's at least 2 episodes past where the
          // viewer is — a 1-episode gap is just normal pacing, not
          // worth calling out, but a bigger one is the "they're
          // bingeing ahead of us" moment the user asked to surface.
          const aheadCount = m.user_id !== myUserId ? m.watchedCount - myWatchedCount : 0;
          const isAhead = aheadCount >= 2;
          return (
            <View key={m.user_id} style={[styles.progressRow, compact && styles.progressRowCompact]}>
              <Avatar name={m.username} imageUri={m.avatar_url} size={compact ? "xs" : "sm"} />
              <View style={{ flex: 1 }}>
                <View style={styles.progressNameRow}>
                  <View style={styles.progressNameWithBadge}>
                    <Text style={[styles.progressName, compact && styles.progressNameCompact]} numberOfLines={1}>
                      {m.username}
                    </Text>
                    {isAhead && (
                      <View style={styles.aheadBadge}>
                        <Ionicons name="play-skip-forward" size={10} color={colors.yellow} />
                        <Text style={styles.aheadBadgeText}>{t.rooms.aheadBadge(aheadCount)}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.progressCount}>
                    {m.watchedCount}/{p.totalEpisodes}
                  </Text>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${pct}%` }]} />
                </View>
              </View>
            </View>
          );
        })}
      </>
    );
  }

  const membersById = new Map(room.members.map((m) => [m.user_id, m.profile]));
  const openGroup = openGroupKey ? watchLog.find((g) => g.key === openGroupKey) ?? null : null;
  const watchlistShowIds = new Set(watchlist.filter((e) => e.tvmaze_show_id != null).map((e) => e.tvmaze_show_id!));
  const watchlistMovieIds = new Set(watchlist.filter((e) => e.tmdb_id != null).map((e) => e.tmdb_id!));

  // One poster tile, shared by "Want to watch together" and "Watched
  // together" — the room used to list both as full-width text rows, which
  // turned into a long wall once the group had more than a handful queued.
  function renderPosterTile({
    key,
    image,
    title,
    kind,
    badge,
    corner,
    onPress,
  }: {
    key: string;
    image: string | null;
    title: string;
    kind: "show" | "movie";
    badge?: string;
    corner?: ReactNode;
    onPress: () => void;
  }) {
    return (
      <Pressable key={key} style={styles.tile} onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
        <View style={styles.tilePosterWrap}>
          {image ? (
            <Image source={{ uri: image }} style={styles.tilePoster} contentFit="cover" />
          ) : (
            <View style={[styles.tilePoster, styles.watchThumbPlaceholder]}>
              <Ionicons name={kind === "show" ? "tv-outline" : "film-outline"} size={22} color={colors.textFaint} />
            </View>
          )}
          <View style={styles.tileKind}>
            <Ionicons name={kind === "show" ? "tv" : "film"} size={10} color="#fff" />
            {badge && <Text style={styles.tileKindText}>{badge}</Text>}
          </View>
          {corner}
        </View>
        <Text style={styles.tileTitle} numberOfLines={2}>
          {title}
        </Text>
      </Pressable>
    );
  }

  function renderTiles(tiles: ReactNode[], expanded: boolean) {
    if (expanded) return <View style={styles.tileGrid}>{tiles}</View>;
    return <HorizontalScrollRow contentContainerStyle={styles.tileRow}>{tiles}</HorizontalScrollRow>;
  }

  function renderSectionHeader(label: string, count: number, expanded: boolean, onToggle: () => void) {
    return (
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{label}</Text>
        {count > 0 && <Text style={styles.sectionCount}>{count}</Text>}
        <View style={{ flex: 1 }} />
        {count > 3 && (
          <Pressable onPress={onToggle} hitSlop={8} accessibilityRole="button">
            <Text style={styles.seeAll}>{expanded ? t.rooms.seeLess : t.explore.viewAll}</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }} />
        {isOwner ? (
          <Pressable onPress={openEdit} hitSlop={10} accessibilityRole="button" accessibilityLabel={t.rooms.editRoom}>
            <Ionicons name="pencil-outline" size={20} color={colors.text} />
          </Pressable>
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.hero}>
          <LinearGradient colors={[`${heroHue}33`, "transparent"]} style={styles.heroGlow} pointerEvents="none" />
          <View style={styles.heroRow}>
            <RoomBadge name={room.name} emoji={room.emoji} size={64} />
            <View style={{ flex: 1 }}>
              <Text style={styles.heroName} numberOfLines={2}>
                {room.name}
              </Text>
              <View style={styles.heroMetaRow}>
                {accepted.length > 0 && (
                  <AvatarStack
                    members={accepted.map((m) => ({ name: m.profile?.username, imageUri: m.profile?.avatar_url }))}
                    size="sm"
                    max={5}
                    ringColor={colors.background}
                  />
                )}
                <Pill size="sm" tone={expired ? "neutral" : "accent"}>
                  {expiryText}
                </Pill>
              </View>
            </View>
          </View>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{watchlist.length}</Text>
              <Text style={styles.heroStatLabel}>{t.rooms.statToWatch}</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{watchLog.length}</Text>
              <Text style={styles.heroStatLabel}>{t.rooms.statWatched}</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{accepted.length}</Text>
              <Text style={styles.heroStatLabel}>{t.rooms.members}</Text>
            </View>
          </View>
          <View style={styles.actionsRow}>
            <Pressable style={[styles.actionBtn, styles.actionBtnPrimary]} onPress={() => setAddToWatchlistOpen(true)} accessibilityRole="button">
              <Ionicons name="add" size={18} color={colors.onAccent} />
              <Text style={[styles.actionText, styles.actionTextPrimary]} numberOfLines={1}>
                {t.rooms.actionAddToWatch}
              </Text>
            </Pressable>
            <Pressable style={styles.actionBtn} onPress={() => setAddOpen(true)} accessibilityRole="button">
              <Ionicons name="add" size={18} color={colors.text} />
              <Text style={styles.actionText} numberOfLines={1}>
                {t.rooms.actionAddWatched}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.body}>
          {inProgress.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t.rooms.currentlyWatching}</Text>
              </View>
              {inProgress.length === 1 ? (
                <View style={styles.card}>{renderShowProgress(inProgress[0], false)}</View>
              ) : (
                // Several shows going at once: one compact tile each, side
                // by side, so the section stays one tile tall however many
                // the group has on the go instead of pushing everything
                // else down the page.
                <HorizontalScrollRow contentContainerStyle={styles.progressCarouselContent}>
                  {inProgress.map((p) => (
                    <View key={p.show.id} style={styles.progressTile}>
                      {renderShowProgress(p, true)}
                    </View>
                  ))}
                </HorizontalScrollRow>
              )}
            </View>
          )}

          <View style={styles.section}>
            {renderSectionHeader(t.rooms.wantToWatch, watchlist.length, watchlistExpanded, () => setWatchlistExpanded((v) => !v))}
            {watchlist.length === 0 ? (
              <Pressable style={styles.emptyCard} onPress={() => setAddToWatchlistOpen(true)} accessibilityRole="button">
                <Ionicons name="bookmark-outline" size={20} color={colors.textFaint} />
                <Text style={styles.emptyText}>{t.rooms.noWantToWatch}</Text>
              </Pressable>
            ) : (
              renderTiles(
                watchlist.map((entry) => {
                  const adder = membersById.get(entry.added_by);
                  return renderPosterTile({
                    key: entry.id,
                    image: entry.content_type === "movie" ? posterUrl(entry.image_url, "w200") : entry.image_url,
                    title: entry.title,
                    kind: entry.content_type,
                    onPress: () =>
                      router.push(
                        entry.content_type === "show" ? `/show/${entry.tvmaze_show_id}` : `/movie/tmdb/${entry.tmdb_id}`,
                      ),
                    corner: (
                      <>
                        {adder && (
                          <View style={styles.tileAdder}>
                            <Avatar name={adder.username} imageUri={adder.avatar_url} size="xs" />
                          </View>
                        )}
                        {/* Only whoever added it or the room's owner can
                            remove it (the delete policy on room_watchlist) —
                            for anyone else the tile used to vanish and then
                            come back on the next refresh. */}
                        {(entry.added_by === myUserId || isOwner) && (
                        <Pressable
                          style={styles.tileRemove}
                          onPress={(e) => {
                            e.stopPropagation();
                            handleRemoveFromWatchlist(entry.id);
                          }}
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel={t.rooms.removeFromWatchlist}
                        >
                          <Ionicons name="close" size={13} color="#fff" />
                        </Pressable>
                        )}
                      </>
                    ),
                  });
                }),
                watchlistExpanded,
              )
            )}
          </View>

          <View style={styles.section}>
            {renderSectionHeader(t.rooms.watchedTogether, watchLog.length, watchedExpanded, () => setWatchedExpanded((v) => !v))}
            {watchLog.length === 0 ? (
              <Pressable style={styles.emptyCard} onPress={() => setAddOpen(true)} accessibilityRole="button">
                <Ionicons name="checkmark-done" size={20} color={colors.textFaint} />
                <Text style={styles.emptyText}>{t.rooms.noWatchedTogether}</Text>
              </Pressable>
            ) : (
              renderTiles(
                watchLog.map((g) =>
                  renderPosterTile({
                    key: g.key,
                    image: g.imageUrl,
                    title: g.title,
                    kind: g.kind,
                    badge: g.kind === "show" ? t.rooms.episodesShort(g.episodeCount) : g.episodeCount > 1 ? `x${g.episodeCount}` : undefined,
                    onPress: () => setOpenGroupKey(g.key),
                  }),
                ),
                watchedExpanded,
              )
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t.rooms.members}</Text>
              <Text style={styles.sectionCount}>{accepted.length}</Text>
            </View>
            <View style={styles.memberGrid}>
              {[...accepted, ...pending].map((m) => {
                const isPending = m.status === "invited";
                const username = m.profile?.username ?? "?";
                return (
                  <Pressable
                    key={m.user_id}
                    style={[styles.memberChip, isPending && styles.memberChipPending]}
                    onPress={() => router.push({ pathname: "/users/[id]", params: { id: m.user_id } })}
                    accessibilityRole="button"
                    accessibilityLabel={username}
                  >
                    <View>
                      <Avatar name={username} imageUri={m.profile?.avatar_url} size="sm" />
                      {m.user_id === room.owner_id && (
                        <View style={styles.ownerMark}>
                          <Ionicons name="ribbon" size={10} color={colors.onAccent} />
                        </View>
                      )}
                      {isOwner && m.user_id !== room.owner_id && !isPending && (
                        <Pressable
                          style={styles.memberRemove}
                          onPress={(e) => {
                            e.stopPropagation();
                            setRemoveTarget({ user_id: m.user_id, username });
                          }}
                          hitSlop={6}
                          accessibilityRole="button"
                          accessibilityLabel={t.rooms.removeMember}
                        >
                          <Ionicons name="close" size={11} color="#fff" />
                        </Pressable>
                      )}
                    </View>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {username}
                    </Text>
                    {isPending && <Text style={styles.memberPending}>{t.rooms.invited}</Text>}
                  </Pressable>
                );
              })}
              {isOwner && (
                <Pressable style={styles.memberChip} onPress={() => setInviteOpen(true)} accessibilityRole="button">
                  <View style={styles.inviteCircle}>
                    <Ionicons name="person-add-outline" size={18} color={colors.accent} />
                  </View>
                  <Text style={[styles.memberName, { color: colors.accent }]} numberOfLines={1}>
                    {t.rooms.invite}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>

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

      <Sheet visible={!!openGroup} onClose={() => setOpenGroupKey(null)}>
        {openGroup && (
          <View>
            <View style={styles.groupHeader}>
              {openGroup.imageUrl ? (
                <Image source={{ uri: openGroup.imageUrl }} style={styles.watchThumb} />
              ) : (
                <View style={[styles.watchThumb, styles.watchThumbPlaceholder]}>
                  <Ionicons name={openGroup.kind === "show" ? "tv-outline" : "film-outline"} size={18} color={colors.textFaint} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.watchTitle} numberOfLines={2}>
                  {openGroup.title}
                </Text>
                <Text style={styles.watchSubtitle}>
                  {openGroup.kind === "show"
                    ? t.rooms.episodesTogetherCount(openGroup.episodeCount)
                    : t.rooms.movieTogetherCount(openGroup.episodeCount)}
                </Text>
              </View>
            </View>
            <Pressable
              style={styles.groupOpenBtn}
              onPress={() => {
                setOpenGroupKey(null);
                if (openGroup.kind === "show") router.push(`/show/${openGroup.tvmazeShowId}`);
                else router.push(`/movie/tmdb/${openGroup.tmdbId}`);
              }}
              accessibilityRole="button"
            >
              <Text style={styles.groupOpenText}>{openGroup.kind === "show" ? t.rooms.openShow : t.rooms.openMovie}</Text>
            </Pressable>
            {openGroup.kind === "show" ? (
              <ScrollView style={styles.groupEpisodes}>
                {openGroup.entries.map((e) => (
                  <Pressable
                    key={e.id}
                    style={styles.episodeRow}
                    onPress={() => {
                      setOpenGroupKey(null);
                      router.push({
                        pathname: "/episode/[id]",
                        params: { id: String(e.tvmaze_episode_id), showId: String(e.tvmaze_show_id) },
                      });
                    }}
                  >
                    <Text style={styles.episodeText}>
                      S{String(e.season).padStart(2, "0")}E{String(e.number).padStart(2, "0")}
                    </Text>
                    <Pressable
                      onPress={(ev) => {
                        ev.stopPropagation();
                        setUnwatchEntryTarget(e);
                      }}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={t.rooms.unwatchTogether}
                    >
                      <Ionicons name="arrow-undo-outline" size={16} color={colors.textFaint} />
                    </Pressable>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <Pressable style={styles.groupUndoBtn} onPress={() => setUnwatchTarget(openGroup)} accessibilityRole="button">
                <Ionicons name="arrow-undo-outline" size={16} color={colors.red} />
                <Text style={styles.groupUndoText}>{t.rooms.unwatchTogether}</Text>
              </Pressable>
            )}
          </View>
        )}
      </Sheet>

      <Sheet visible={inviteOpen} onClose={() => setInviteOpen(false)}>
        <Text style={styles.sheetTitle}>{t.rooms.invite}</Text>
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
      </Sheet>

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
      <ChoiceDialog
        visible={!!unwatchTarget}
        title={t.rooms.unwatchTogether}
        subtitle={t.rooms.unwatchTogetherConfirm(unwatchTarget?.title ?? "")}
        options={[
          { value: "cancel", label: t.rooms.decline },
          { value: "unwatch", label: t.rooms.unwatchTogether, primary: true },
        ]}
        onChoose={(v) => (v === "unwatch" ? handleUnwatchGroup() : setUnwatchTarget(null))}
        onDismiss={() => setUnwatchTarget(null)}
      />
      <ChoiceDialog
        visible={!!unwatchEntryTarget}
        title={t.rooms.unwatchTogether}
        subtitle={t.rooms.unwatchTogetherConfirm(
          unwatchEntryTarget ? `S${unwatchEntryTarget.season}E${unwatchEntryTarget.number}` : ""
        )}
        options={[
          { value: "cancel", label: t.rooms.decline },
          { value: "unwatch", label: t.rooms.unwatchTogether, primary: true },
        ]}
        onChoose={(v) => (v === "unwatch" ? handleUnwatchEntry() : setUnwatchEntryTarget(null))}
        onDismiss={() => setUnwatchEntryTarget(null)}
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

      <Sheet visible={addToWatchlistOpen} onClose={() => setAddToWatchlistOpen(false)}>
        <AddToWatchlistSheet
          roomId={id}
          existingShowIds={watchlistShowIds}
          existingMovieIds={watchlistMovieIds}
          onAdded={refreshWatchlist}
          onClose={() => setAddToWatchlistOpen(false)}
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
      paddingBottom: 4,
    },
    scrollContent: { paddingBottom: 32 },
    hero: { paddingTop: 4, paddingBottom: 16, paddingHorizontal: 16 },
    heroGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 180 },
    heroRow: { flexDirection: "row", alignItems: "center", gap: 14 },
    heroName: { fontSize: type.title, fontWeight: "800", color: colors.text },
    heroMetaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 6 },
    heroStats: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 16,
      paddingVertical: 10,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      ...dropShadow({ opacity: 0.06, radius: 10, offsetY: 3, elevation: 2 }),
    },
    heroStat: { flex: 1, alignItems: "center" },
    heroStatValue: { fontSize: type.subtitle, fontWeight: "800", color: colors.text },
    heroStatLabel: { fontSize: type.micro, fontWeight: "700", color: colors.textMuted, marginTop: 1 },
    heroStatDivider: { width: StyleSheet.hairlineWidth, alignSelf: "stretch", backgroundColor: colors.border },
    actionsRow: { flexDirection: "row", gap: 10, marginTop: 12 },
    actionBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 11,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    actionBtnPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
    actionText: { fontSize: type.bodySm, fontWeight: "800", color: colors.text, flexShrink: 1 },
    actionTextPrimary: { color: colors.onAccent },
    body: { gap: 22 },
    section: { gap: 10 },
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16 },
    sectionTitle: { fontSize: type.subtitle, fontWeight: "800", color: colors.text },
    sectionCount: {
      fontSize: type.caption,
      fontWeight: "800",
      color: colors.textMuted,
      backgroundColor: colors.pillBg,
      paddingHorizontal: 7,
      paddingVertical: 1,
      borderRadius: radius.pill,
      overflow: "hidden",
    },
    seeAll: { fontSize: type.bodySm, fontWeight: "700", color: colors.accent },
    card: {
      marginHorizontal: 16,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: 14,
      ...dropShadow({ opacity: 0.06, radius: 10, offsetY: 3, elevation: 2 }),
    },
    emptyCard: {
      marginHorizontal: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      padding: 16,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: colors.border,
    },
    emptyText: { flex: 1, fontSize: type.bodySm, color: colors.textMuted },
    tileRow: { paddingHorizontal: 16, gap: 12 },
    tileGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 16 },
    tile: { width: 104 },
    tilePosterWrap: { position: "relative" },
    tilePoster: { width: 104, height: 154, borderRadius: radius.md, backgroundColor: colors.backgroundAlt },
    tileKind: {
      position: "absolute",
      left: 6,
      bottom: 6,
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      paddingHorizontal: 5,
      paddingVertical: 3,
      borderRadius: radius.pill,
      backgroundColor: "rgba(0,0,0,0.65)",
    },
    tileKindText: { fontSize: 10, fontWeight: "800", color: "#fff" },
    tileAdder: { position: "absolute", right: 6, bottom: 6, borderRadius: radius.pill, borderWidth: 1.5, borderColor: "#fff" },
    tileRemove: {
      position: "absolute",
      top: 6,
      right: 6,
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.6)",
    },
    tileTitle: { marginTop: 6, fontSize: type.bodySm, fontWeight: "700", color: colors.text },
    memberGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14, paddingHorizontal: 16 },
    memberChip: { width: 64, alignItems: "center", gap: 5 },
    memberChipPending: { opacity: 0.5 },
    memberName: { fontSize: type.caption, fontWeight: "700", color: colors.text, textAlign: "center", width: "100%" },
    memberPending: { fontSize: 10, color: colors.textMuted, marginTop: -3 },
    ownerMark: {
      position: "absolute",
      right: -2,
      bottom: -2,
      width: 18,
      height: 18,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accent,
      borderWidth: 2,
      borderColor: colors.background,
    },
    memberRemove: {
      position: "absolute",
      top: -4,
      right: -4,
      width: 18,
      height: 18,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.textMuted,
    },
    inviteCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1.5,
      borderStyle: "dashed",
      borderColor: colors.accent,
    },
    groupHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
    groupOpenBtn: {
      alignItems: "center",
      paddingVertical: 11,
      borderRadius: radius.pill,
      backgroundColor: colors.backgroundAlt,
      marginBottom: 8,
    },
    groupOpenText: { fontSize: type.bodySm, fontWeight: "800", color: colors.text },
    groupEpisodes: { maxHeight: 360 },
    groupUndoBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12 },
    groupUndoText: { fontSize: type.bodySm, fontWeight: "700", color: colors.red },
    watchRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
    watchThumb: { width: 40, height: 56, borderRadius: radius.sm, backgroundColor: colors.backgroundAlt },
    watchThumbSmall: { width: 32, height: 46, borderRadius: radius.sm, backgroundColor: colors.background },
    watchThumbPlaceholder: { alignItems: "center", justifyContent: "center" },
    watchTitle: { fontWeight: "700", fontSize: type.body, color: colors.text },
    watchSubtitle: { fontSize: type.caption, color: colors.textMuted, marginTop: 2 },
    episodeRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 7,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    episodeText: { fontSize: type.bodySm, fontWeight: "700", color: colors.textMuted },
    progressRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
    progressRowCompact: { gap: 8, paddingVertical: 4 },
    progressNameCompact: { fontSize: type.bodySm },

    progressCarouselContent: { paddingHorizontal: 16, gap: 10 },
    progressTile: {
      width: 240,
      padding: 12,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      ...dropShadow({ opacity: 0.06, radius: 10, offsetY: 3, elevation: 2 }),
    },
    progressNameRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    progressNameWithBadge: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
    progressName: { flexShrink: 1, fontWeight: "700", fontSize: type.body, color: colors.text },
    aheadBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: radius.pill,
      backgroundColor: colors.yellow + "26",
    },
    aheadBadgeText: { fontSize: 10, fontWeight: "800", color: colors.yellow },
    progressCount: { fontSize: type.caption, fontWeight: "700", color: colors.textMuted },
    progressTrack: { height: 5, borderRadius: radius.pill, backgroundColor: colors.pillBg, marginTop: 5, overflow: "hidden" },
    progressFill: { height: "100%", borderRadius: radius.pill, backgroundColor: colors.accent },
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
    dangerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, paddingVertical: 10, paddingHorizontal: 16 },
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
