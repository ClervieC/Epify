import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { fetchFollowingActivity, ActivityItem } from "../../lib/activity";
import {
  fetchFollowingIds,
  fetchSuggestedBuddies,
  fetchSuggestedMovieBuddies,
  SuggestedBuddy,
  followUser,
  unfollowUser,
} from "../../lib/follows";
import { fetchProfiles, Profile } from "../../lib/profiles";
import { getCurrentUserId } from "../../lib/supabase";
import { posterUrl } from "../../lib/tmdb";
import { shortDate, localDateKey } from "../../lib/dates";
import { FEELING_EMOJIS } from "../../lib/feelings";
import { useColors, radius, type, Colors } from "../../lib/theme";
import { useLanguage, Translations } from "../../lib/i18n";
import { useScrollToTopOnTabPress } from "../../lib/useScrollToTopOnTabPress";
import { useActivityUnseen } from "../../context/ActivityContext";
import { useMountIn, useGrowIn } from "../../lib/animations";
import { Avatar } from "../../components/Avatar";
import { EmptyState } from "../../components/EmptyState";
import { UserRow } from "../../components/UserRow";
import { FollowButton } from "../../components/FollowButton";

function feelingEmoji(key: string | null): string | null {
  return FEELING_EMOJIS.find((f) => f.key === key)?.emoji ?? null;
}

// Small glyph badge on the avatar corner, one per activity kind — gives the
// feed visual rhythm to scan (comments vs. watches) instead of every row
// looking identical until you read the sentence.
type IoniconName = keyof typeof Ionicons.glyphMap;
function kindIcon(kind: ActivityItem["kind"]): IoniconName {
  switch (kind) {
    case "episode_watched":
    case "movie_watched":
      return "eye";
    default:
      return "chatbubble-ellipses";
  }
}

// One feed row for any ActivityItem kind — image/title/verb/meta vary by
// kind (see lib/activity.ts), but the avatar+username+timestamp shell and
// tap-to-open behavior are identical either way.
function ActivityRow({
  item,
  index,
  t,
  colors,
  styles,
}: {
  item: ActivityItem;
  index: number;
  t: Translations;
  colors: Colors;
  styles: Styles;
}) {
  const router = useRouter();
  const username = item.user?.username ?? "?";
  // Only the first screenful staggers — capped so a long feed doesn't leave
  // rows 30+ waiting on a multi-second delay chain before they ever appear.
  const mountIn = useMountIn(Math.min(index, 8) * 45);

  let image: string | null = null;
  let title = "";
  let verb = "";
  let rating: number | null = null;
  let feeling: string | null = null;
  let body: string | null = null;
  let onPress = () => {};
  // Set only for show-backed kinds (episode watched/commented, show
  // commented) — lets the title/cover jump straight to the show instead of
  // wherever the row itself points (an episode, for the watched/commented-
  // on-episode kinds). Movie kinds already point their whole row at the
  // movie itself, so there's no separate "show" destination to carve out.
  let showId: number | null = null;

  switch (item.kind) {
    case "episode_watched":
      image = item.showImage;
      title = item.showName;
      verb = t.activity.watchedEpisode(item.season, item.number);
      rating = item.rating;
      feeling = item.feeling;
      showId = item.showId;
      onPress = () => router.push({ pathname: "/episode/[id]", params: { id: String(item.episodeId), showId: String(item.showId) } });
      break;
    case "movie_watched":
      image = posterUrl(item.moviePosterPath, "w200");
      title = item.movieTitle;
      verb = t.activity.watchedMovie;
      rating = item.rating;
      feeling = item.feeling;
      onPress = () => item.movieTmdbId != null && router.push(`/movie/tmdb/${item.movieTmdbId}`);
      break;
    case "show_comment":
      image = item.showImage;
      title = item.showName;
      verb = t.activity.commentedOnShow;
      body = item.body;
      showId = item.showId;
      onPress = () => router.push(`/show/${item.showId}`);
      break;
    case "episode_comment":
      image = item.showImage;
      title = item.showName;
      verb = t.activity.commentedOnEpisode;
      body = item.body;
      showId = item.showId;
      onPress = () =>
        item.episodeId != null &&
        router.push({ pathname: "/episode/[id]", params: { id: String(item.episodeId), showId: String(item.showId) } });
      break;
    case "movie_comment":
      image = posterUrl(item.moviePosterPath, "w200");
      title = item.movieTitle;
      verb = t.activity.commentedOnMovie;
      body = item.body;
      onPress = () => router.push(`/movie/tmdb/${item.movieTmdbId}`);
      break;
  }

  function goToShow(e: { stopPropagation: () => void }) {
    e.stopPropagation();
    if (showId != null) router.push(`/show/${showId}`);
  }

  return (
    <Animated.View style={{ opacity: mountIn.opacity, transform: mountIn.transform }}>
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={onPress}
      >
        {/* Its own Pressable + stopPropagation, same idea as the show
            thumbnail in components/EpisodeRow.tsx — the row's own tap opens
            the show/episode/movie, this one opens the person instead. */}
        <Pressable
          style={styles.avatarWrap}
          onPress={(e) => {
            e.stopPropagation();
            if (item.user) router.push({ pathname: "/users/[id]", params: { id: item.user.user_id } });
          }}
        >
          <Avatar name={username} imageUri={item.user?.avatar_url} size="sm" />
          <View style={[styles.kindBadge, { backgroundColor: rating != null || feeling ? colors.accent : colors.blue }]}>
            <Ionicons name={kindIcon(item.kind)} size={11} color={colors.onAccent} />
          </View>
        </Pressable>
        <View style={styles.rowContent}>
          <Text style={styles.rowText}>
            <Text
              style={styles.username}
              onPress={
                item.user
                  ? (e) => {
                      e.stopPropagation();
                      router.push({ pathname: "/users/[id]", params: { id: item.user!.user_id } });
                    }
                  : undefined
              }
            >
              {username}
            </Text>
            <Text style={styles.verb}> {verb} </Text>
            <Text style={styles.title} onPress={showId != null ? goToShow : undefined}>
              {title}
            </Text>
          </Text>
          {body && (
            <Text style={styles.body} numberOfLines={2}>
              {body}
            </Text>
          )}
          <View style={styles.metaRow}>
            {rating != null && (
              <View style={styles.metaChip}>
                <Text style={styles.metaChipText}>⭐ {rating}</Text>
              </View>
            )}
            {feeling && (
              <View style={styles.metaChip}>
                <Text style={styles.metaChipText}>{feelingEmoji(feeling)}</Text>
              </View>
            )}
            <Text style={styles.metaTime}>{shortDate(item.createdAt)}</Text>
          </View>
        </View>
        {showId != null ? (
          <Pressable onPress={goToShow}>
            {image ? (
              <Image source={{ uri: image }} style={styles.thumb} contentFit="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <Ionicons name="film-outline" size={18} color={colors.textFaint} />
              </View>
            )}
          </Pressable>
        ) : image ? (
          <Image source={{ uri: image }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name="film-outline" size={18} color={colors.textFaint} />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

type EpisodeWatchedItem = Extract<ActivityItem, { kind: "episode_watched" }>;

// A group's own header row — mirrors ActivityRow's shell (avatar/username/
// verb/title/thumb) but the tap toggles an inline expanded list of the
// individual episodes instead of navigating anywhere, since there's no
// single episode/show pairing left to open once several are collapsed
// together. Manages its own expanded state locally (not lifted to
// ActivityScreen) — nothing else on screen needs to know or react to it.
function EpisodeGroupRow({
  items,
  index,
  t,
  colors,
  styles,
}: {
  items: EpisodeWatchedItem[];
  index: number;
  t: Translations;
  colors: Colors;
  styles: Styles;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const mountIn = useMountIn(Math.min(index, 8) * 45);
  const first = items[0];
  const username = first.user?.username ?? "?";
  const sortedEpisodes = useMemo(
    () => [...items].sort((a, b) => a.season - b.season || a.number - b.number),
    [items],
  );

  function goToShow(e: { stopPropagation: () => void }) {
    e.stopPropagation();
    router.push(`/show/${first.showId}`);
  }

  return (
    <Animated.View style={{ opacity: mountIn.opacity, transform: mountIn.transform }}>
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={() => setExpanded((e) => !e)}
      >
        <Pressable
          style={styles.avatarWrap}
          onPress={(e) => {
            e.stopPropagation();
            if (first.user) router.push({ pathname: "/users/[id]", params: { id: first.user.user_id } });
          }}
        >
          <Avatar name={username} imageUri={first.user?.avatar_url} size="sm" />
          <View style={[styles.kindBadge, { backgroundColor: colors.blue }]}>
            <Ionicons name="eye" size={11} color={colors.onAccent} />
          </View>
        </Pressable>
        <View style={styles.rowContent}>
          <Text style={styles.rowText}>
            <Text
              style={styles.username}
              onPress={
                first.user
                  ? (e) => {
                      e.stopPropagation();
                      router.push({ pathname: "/users/[id]", params: { id: first.user!.user_id } });
                    }
                  : undefined
              }
            >
              {username}
            </Text>
            <Text style={styles.verb}> {t.activity.watchedEpisodes(items.length)} </Text>
            <Text style={styles.title} onPress={goToShow}>
              {first.showName}
            </Text>
          </Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaTime}>{shortDate(first.createdAt)}</Text>
          </View>
        </View>
        <View style={styles.groupThumbCol}>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textFaint} />
          <Pressable onPress={goToShow}>
            {first.showImage ? (
              <Image source={{ uri: first.showImage }} style={styles.thumb} contentFit="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <Ionicons name="film-outline" size={18} color={colors.textFaint} />
              </View>
            )}
          </Pressable>
        </View>
      </Pressable>
      {expanded && (
        <View style={styles.groupChildren}>
          {sortedEpisodes.map((ep) => (
            <Pressable
              key={ep.id}
              style={styles.groupChildRow}
              onPress={() =>
                router.push({ pathname: "/episode/[id]", params: { id: String(ep.episodeId), showId: String(ep.showId) } })
              }
            >
              <Text style={styles.groupChildCode}>
                S{ep.season} · E{ep.number}
              </Text>
              <View style={styles.groupChildMeta}>
                {ep.rating != null && <Text style={styles.metaChipText}>⭐ {ep.rating}</Text>}
                {ep.feeling && <Text style={styles.metaChipText}>{feelingEmoji(ep.feeling)}</Text>}
                <Text style={styles.metaTime}>{shortDate(ep.createdAt)}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </Animated.View>
  );
}

type FeedRow =
  | { type: "item"; item: ActivityItem }
  | { type: "episodeGroup"; key: string; items: EpisodeWatchedItem[] };

// Collapses same-user/same-show/same-day "watched episode" activity into one
// row — without this, adding a show you'd already finished (or any binge
// session) flooded the feed with a run of near-identical lines. Grouped by
// calendar day rather than a tighter time window: a bulk "mark season
// watched" gives every row in that action the exact same timestamp anyway
// (see lib/userShows.ts), and a real multi-hour binge session should still
// read as one thing, not fragment back apart just because of the gaps
// between episodes. Only episode_watched groups — movies and comments stay
// as individual rows, since those don't tend to arrive in the same bursts.
function groupActivityItems(items: ActivityItem[]): FeedRow[] {
  const groups = new Map<string, EpisodeWatchedItem[]>();
  for (const item of items) {
    if (item.kind !== "episode_watched") continue;
    const key = `${item.user?.user_id ?? "?"}__${item.showId}__${localDateKey(item.createdAt)}`;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  const rows: FeedRow[] = [];
  const consumed = new Set<string>();
  for (const item of items) {
    if (consumed.has(item.id)) continue;
    if (item.kind === "episode_watched") {
      const key = `${item.user?.user_id ?? "?"}__${item.showId}__${localDateKey(item.createdAt)}`;
      const group = groups.get(key)!;
      if (group.length > 1) {
        for (const g of group) consumed.add(g.id);
        rows.push({ type: "episodeGroup", key, items: group });
        continue;
      }
    }
    rows.push({ type: "item", item });
  }
  return rows;
}

type ActivityTab = "activity" | "suggested";
type SuggestedRow = {
  user_id: string;
  profile: Profile;
  showMatch: SuggestedBuddy | null;
  movieMatch: SuggestedBuddy | null;
};

export default function ActivityScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<ActivityTab>("activity");
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasFollows, setHasFollows] = useState(true);
  // null (not []) while unloaded so the tab shows a spinner instead of a
  // flash of "no matches" before the RPC round trip resolves.
  const [suggested, setSuggested] = useState<SuggestedRow[] | null>(null);
  // Every row starts as "not following" — suggested_show_buddies() already
  // excludes people the caller follows (see supabase/schema.sql), so there's
  // no existing-follow state to prefetch, same assumption app/users/search.tsx
  // makes for its own results.
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const underlineGrow = useGrowIn(tab);
  const feedRows = useMemo(() => groupActivityItems(items), [items]);
  const listRef = useRef<FlatList<FeedRow>>(null);
  const suggestedListRef = useRef<FlatList<SuggestedRow>>(null);
  const { markSeen } = useActivityUnseen();
  // Whether another (older) page exists beyond what's currently loaded, and
  // whether one is being fetched right now — the latter guards onEndReached
  // against firing several times over for the same page while its request
  // is still in flight (FlatList can call it repeatedly during a fast
  // scroll).
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { items: data, hasMore: more } = await fetchFollowingActivity();
      setItems(data);
      setHasMore(more);
      // fetchFollowingActivity() returns [] both when you follow nobody and
      // when everyone you follow simply has no activity yet — the empty
      // state should say something different for each (see below), so this
      // needs its own check rather than inferring it from items.length.

      // Marks seen using the timestamp of the item actually on screen (the
      // list is sorted newest-first), not ActivityContext's own `latestAt` —
      // that one is only refreshed by the Stack-level focus effect, which
      // doesn't fire on a plain tab switch to Activity, so it could still be
      // pointing at an older "latest" than what just loaded here.
      markSeen(data[0]?.createdAt);
    } finally {
      setLoading(false);
    }
  }, [markSeen]);

  // Deliberately not in the load()/useFocusEffect dependency chain — this
  // only ever fires from the user actually scrolling near the bottom, never
  // from a focus/refresh, so it reads its cursor off the current `items`
  // state directly rather than needing it threaded through as a parameter.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || items.length === 0) return;
    setLoadingMore(true);
    try {
      const cursor = items[items.length - 1].createdAt;
      const { items: more, hasMore: nextHasMore } = await fetchFollowingActivity(cursor);
      setItems((prev) => [...prev, ...more]);
      setHasMore(nextHasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, items]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      load();
      getCurrentUserId().then(async (myId) => {
        if (!active || !myId) return;
        const following = await fetchFollowingIds(myId);
        if (active) setHasFollows(following.length > 0);
      });
      return () => {
        active = false;
      };
    }, [load])
  );

  // Lazy-loads on first visit to the tab, same reasoning as Movies' To
  // Watch/Upcoming tabs (see app/(tabs)/movies.tsx) — no reason to make
  // every Activity focus pay for the RPC + profile lookups when the user
  // might never open this tab at all.
  useEffect(() => {
    if (tab !== "suggested" || suggested !== null) return;
    let active = true;
    // Shows and movies are ranked independently (see fetchSuggestedBuddies/
    // fetchSuggestedMovieBuddies) and merged here by user_id, rather than
    // blended into one score server-side — someone can qualify on either
    // axis alone, and the two percentages stay visible as two separate
    // stats instead of hiding which kind of taste actually overlaps.
    Promise.all([fetchSuggestedBuddies(), fetchSuggestedMovieBuddies()])
      .then(async ([showBuddies, movieBuddies]) => {
        const showById = new Map(showBuddies.map((b) => [b.user_id, b]));
        const movieById = new Map(movieBuddies.map((b) => [b.user_id, b]));
        const userIds = [...new Set([...showById.keys(), ...movieById.keys()])];
        const profiles = await fetchProfiles(userIds);
        const profileById = new Map(profiles.map((p) => [p.user_id, p]));
        if (!active) return;
        const rows = userIds.flatMap((id) => {
          const profile = profileById.get(id);
          if (!profile) return [];
          return [{ user_id: id, profile, showMatch: showById.get(id) ?? null, movieMatch: movieById.get(id) ?? null }];
        });
        rows.sort(
          (a, b) =>
            Math.max(b.showMatch?.match_percent ?? 0, b.movieMatch?.match_percent ?? 0) -
            Math.max(a.showMatch?.match_percent ?? 0, a.movieMatch?.match_percent ?? 0)
        );
        setSuggested(rows);
      })
      .catch(() => active && setSuggested([]));
    return () => {
      active = false;
    };
  }, [tab, suggested]);

  useScrollToTopOnTabPress(() => {
    const ref = tab === "activity" ? listRef : suggestedListRef;
    ref.current?.scrollToOffset({ offset: 0, animated: true });
  });

  async function toggleFollow(userId: string) {
    const isFollowing = followingIds.has(userId);
    setBusyIds((prev) => new Set(prev).add(userId));
    try {
      if (isFollowing) {
        await unfollowUser(userId);
        setFollowingIds((prev) => {
          const next = new Set(prev);
          next.delete(userId);
          return next;
        });
      } else {
        await followUser(userId);
        setFollowingIds((prev) => new Set(prev).add(userId));
      }
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={[colors.headerGlow, "transparent"]} style={styles.headerGlow} />
      <View style={styles.headerBlock}>
        <Text style={styles.header}>{t.activity.title}</Text>
        {tab === "activity" && !loading && items.length > 0 && <Text style={styles.subtitle}>{t.activity.subtitle}</Text>}
        {tab === "suggested" && <Text style={styles.subtitle}>{t.activity.suggestedSubtitle}</Text>}
      </View>

      <View style={styles.tabsRow}>
        <Pressable style={styles.tabBtn} onPress={() => setTab("activity")}>
          <Text style={[styles.tabText, tab === "activity" && styles.tabTextActive]}>{t.activity.tabActivity}</Text>
          {tab === "activity" && <Animated.View style={[styles.tabUnderline, { transform: [{ scaleX: underlineGrow }] }]} />}
        </Pressable>
        <Pressable style={styles.tabBtn} onPress={() => setTab("suggested")}>
          <Text style={[styles.tabText, tab === "suggested" && styles.tabTextActive]}>{t.activity.tabSuggested}</Text>
          {tab === "suggested" && <Animated.View style={[styles.tabUnderline, { transform: [{ scaleX: underlineGrow }] }]} />}
        </Pressable>
      </View>

      {tab === "activity" ? (
        loading ? (
          <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
        ) : items.length === 0 ? (
          <EmptyState
            icon="pulse-outline"
            title={hasFollows ? t.activity.empty : t.activity.emptyNoFollows}
          />
        ) : (
          <FlatList
            ref={listRef}
            data={feedRows}
            keyExtractor={(row) => (row.type === "item" ? row.item.id : row.key)}
            renderItem={({ item: row, index }) =>
              row.type === "item" ? (
                <ActivityRow item={row.item} index={index} t={t} colors={colors} styles={styles} />
              ) : (
                <EpisodeGroupRow items={row.items} index={index} t={t} colors={colors} styles={styles} />
              )
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            onEndReached={loadMore}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              loadingMore ? <ActivityIndicator color={colors.black} style={styles.loadMoreSpinner} /> : null
            }
          />
        )
      ) : suggested === null ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : suggested.length === 0 ? (
        <EmptyState icon="people-outline" title={t.activity.suggestedEmpty} />
      ) : (
        <FlatList
          ref={suggestedListRef}
          data={suggested}
          keyExtractor={(item) => item.user_id}
          renderItem={({ item }) => (
            <UserRow
              username={item.profile.username}
              imageUri={item.profile.avatar_url}
              subtitleLines={[
                ...(item.showMatch ? [t.activity.sharedShows(item.showMatch.shared_count, item.showMatch.match_percent)] : []),
                ...(item.movieMatch
                  ? [t.activity.sharedMovies(item.movieMatch.shared_count, item.movieMatch.match_percent)]
                  : []),
              ]}
              onPress={() => router.push({ pathname: "/users/[id]", params: { id: item.user_id } })}
              trailing={
                <FollowButton
                  following={followingIds.has(item.user_id)}
                  loading={busyIds.has(item.user_id)}
                  onPress={() => toggleFollow(item.user_id)}
                />
              }
            />
          )}
          contentContainerStyle={styles.suggestedList}
          showsVerticalScrollIndicator={false}
        />
      )}

      {tab === "activity" && !hasFollows && !loading && (
        <Pressable style={styles.findPeopleBtn} onPress={() => router.push("/users/search")}>
          <Text style={styles.findPeopleBtnText}>{t.activity.findPeople}</Text>
        </Pressable>
      )}
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    headerGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 140, pointerEvents: "none" },
    headerBlock: { padding: 16, paddingBottom: 12 },
    header: { fontSize: type.title, fontWeight: "800", color: colors.text },
    subtitle: { fontSize: type.bodySm, color: colors.textMuted, marginTop: 2 },
    tabsRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      marginTop: 4,
    },
    tabBtn: { flex: 1, alignItems: "center", paddingVertical: 12 },
    tabText: { fontWeight: "800", fontSize: 13, color: colors.textFaint, letterSpacing: 0.4 },
    tabTextActive: { color: colors.accent },
    tabUnderline: { height: 2, backgroundColor: colors.accent, width: "60%", marginTop: 6 },
    list: { paddingHorizontal: 16, paddingBottom: 32 },
    // No horizontal padding here — unlike ActivityRow, UserRow already pads
    // itself horizontally (see components/UserRow.tsx), same as how
    // app/users/search.tsx lists its own results.
    suggestedList: { paddingBottom: 32 },
    separator: { height: 10 },
    loadMoreSpinner: { marginTop: 16, marginBottom: 8 },
    row: {
      flexDirection: "row",
      gap: 12,
      alignItems: "flex-start",
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
    },
    rowPressed: { opacity: 0.7 },
    avatarWrap: { position: "relative" },
    kindBadge: {
      position: "absolute",
      bottom: -2,
      right: -2,
      width: 18,
      height: 18,
      borderRadius: 999,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: colors.surface,
    },
    rowContent: { flex: 1, gap: 2 },
    rowText: { fontSize: type.bodySm, lineHeight: 19 },
    username: { fontWeight: "800", color: colors.text },
    verb: { color: colors.textMuted },
    title: { fontWeight: "700", color: colors.text },
    body: {
      fontSize: type.caption,
      color: colors.textMuted,
      marginTop: 2,
      backgroundColor: colors.backgroundAlt,
      borderRadius: radius.sm,
      padding: 8,
    },
    metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
    metaChip: {
      backgroundColor: colors.accentSoft,
      borderRadius: radius.pill,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    metaChipText: { fontSize: type.caption, color: colors.accentDark, fontWeight: "700" },
    metaTime: { fontSize: type.micro, color: colors.textFaint, marginLeft: "auto" },
    thumb: {
      width: 46,
      height: 66,
      borderRadius: radius.sm,
      backgroundColor: colors.backgroundAlt,
    },
    thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
    groupThumbCol: { alignItems: "center", gap: 6 },
    groupChildren: { marginTop: 4, marginLeft: 44, gap: 2 },
    groupChildRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    groupChildCode: { fontSize: type.caption, fontWeight: "700", color: colors.text },
    groupChildMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: "auto" },
    findPeopleBtn: {
      alignSelf: "center",
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
      paddingVertical: 10,
      paddingHorizontal: 20,
      marginBottom: 24,
    },
    findPeopleBtnText: { color: colors.onAccent, fontWeight: "700" },
  });
}
