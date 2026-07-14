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
import { shortDate } from "../../lib/dates";
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

  switch (item.kind) {
    case "episode_watched":
      image = item.showImage;
      title = item.showName;
      verb = t.activity.watchedEpisode(item.season, item.number);
      rating = item.rating;
      feeling = item.feeling;
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
      onPress = () => router.push(`/show/${item.showId}`);
      break;
    case "episode_comment":
      image = item.showImage;
      title = item.showName;
      verb = t.activity.commentedOnEpisode;
      body = item.body;
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
            <Text style={styles.title}>{title}</Text>
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
        {image ? (
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
  const listRef = useRef<FlatList<ActivityItem>>(null);
  const suggestedListRef = useRef<FlatList<SuggestedRow>>(null);
  const { markSeen } = useActivityUnseen();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchFollowingActivity();
      setItems(data);
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
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => <ActivityRow item={item} index={index} t={t} colors={colors} styles={styles} />}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
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
