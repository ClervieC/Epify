import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  FlatList,
  Pressable,
  Animated,
  StyleSheet,
  Image,
  ActivityIndicator,
  Share,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getShow, getShowCast, getShowEpisodes, CastMember, TVMazeEpisode, TVMazeShow } from "../../lib/tvmaze";
import { getCachedEpisodes, getCachedShow, getCachedWatchedEpisodes } from "../../lib/showDataCache";
import {
  fetchEpisodeFeelingCounts,
  fetchWatchedEpisodes,
  incrementRewatch,
  rateEpisode,
  setEpisodeWatched,
  WatchedEpisode,
} from "../../lib/userShows";
import { useColors, radius, Colors } from "../../lib/theme";
import { useLanguage, Translations } from "../../lib/i18n";
import { useScalePress, useMountIn } from "../../lib/animations";
import { WatchedCheck } from "../../components/WatchedCheck";
import { CommentsSection } from "../../components/CommentsSection";
import { CharacterVote } from "../../components/CharacterVote";
import { supabase } from "../../lib/supabase";
import {
  deleteComment,
  fetchEpisodeComments,
  postEpisodeComment,
  toggleCommentReaction,
  EnrichedComment,
} from "../../lib/comments";
import {
  fetchCharacterVotes,
  removeCharacterVote,
  voteForCharacter,
  CharacterVoteTally,
} from "../../lib/characterVotes";

const FEELING_EMOJIS = [
  { key: "lol", emoji: "😂" },
  { key: "shocked", emoji: "😱" },
  { key: "heartbroken", emoji: "💔" },
  { key: "mindblown", emoji: "🤯" },
  { key: "bored", emoji: "😴" },
] as const;

const MAX_DOTS = 5;

function stripHtml(html: string | null) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "");
}

export default function EpisodeDetailScreen() {
  const { id, showId } = useLocalSearchParams<{ id: string; showId: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const showIdNum = Number(showId);
  const initialEpisodeId = Number(id);

  const [show, setShow] = useState<TVMazeShow | null>(null);
  const [episodes, setEpisodes] = useState<TVMazeEpisode[]>([]);
  const [cast, setCast] = useState<CastMember[]>([]);
  const [watchedMap, setWatchedMap] = useState<Record<number, WatchedEpisode | null>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [positioned, setPositioned] = useState(false);
  const listRef = useRef<FlatList<TVMazeEpisode>>(null);
  const hasScrolledToInitial = useRef(false);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t, spoilerMode } = useLanguage();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setPositioned(false);
      hasScrolledToInitial.current = false;
      Promise.all([
        showIdNum ? getCachedShow(showIdNum, () => getShow(showIdNum)) : Promise.resolve(null),
        showIdNum ? getCachedEpisodes(showIdNum, () => getShowEpisodes(showIdNum)) : Promise.resolve([]),
        showIdNum ? getCachedWatchedEpisodes(showIdNum, () => fetchWatchedEpisodes(showIdNum)) : Promise.resolve([]),
        showIdNum ? getShowCast(showIdNum).catch(() => []) : Promise.resolve([]),
      ]).then(([sh, eps, watchedList, castData]) => {
        if (!active) return;
        setShow(sh);
        setEpisodes(eps);
        setCast(castData);
        const map: Record<number, WatchedEpisode | null> = {};
        for (const w of watchedList) map[w.tvmaze_episode_id] = w;
        setWatchedMap(map);
        const idx = eps.findIndex((e) => e.id === initialEpisodeId);
        setCurrentIndex(idx >= 0 ? idx : 0);
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }, [initialEpisodeId, showIdNum])
  );

  // FlatList's initialScrollIndex prop is unreliable for this — especially on
  // web, it's been observed landing on the wrong page for larger indexes (e.g.
  // opening S3E2 would show S1E2 instead), so positioning is done imperatively
  // here instead and the FlatList is kept hidden (see `positioned` below)
  // until it lands correctly, so the wrong episode is never visible even
  // briefly. Runs once per episode open (hasScrolledToInitial is reset in the
  // focus effect above), not on every currentIndex change from swiping.
  useEffect(() => {
    if (loading || hasScrolledToInitial.current) return;
    hasScrolledToInitial.current = true;
    const targetIndex = currentIndex;
    const attempt = () => listRef.current?.scrollToOffset({ offset: targetIndex * width, animated: false });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      attempt();
      setPositioned(true);
    }));
    setTimeout(() => {
      attempt();
      setPositioned(true);
    }, 80);
  }, [loading, currentIndex, width]);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = Math.round(e.nativeEvent.contentOffset.x / width);
    setCurrentIndex((prev) => (prev === index ? prev : index));
  }

  async function toggleWatched(episode: TVMazeEpisode) {
    const isWatched = !!watchedMap[episode.id];
    const result = await setEpisodeWatched({
      tvmaze_show_id: showIdNum,
      tvmaze_episode_id: episode.id,
      season: episode.season,
      number: episode.number,
      watched: !isWatched,
    });
    setWatchedMap((prev) => ({ ...prev, [episode.id]: result }));
  }

  async function rewatchEpisode(episode: TVMazeEpisode) {
    const current = watchedMap[episode.id];
    if (!current) return;
    const result = await incrementRewatch(episode.id, current.times_watched);
    setWatchedMap((prev) => ({ ...prev, [episode.id]: result }));
  }

  async function setRating(episode: TVMazeEpisode, value: number) {
    const current = watchedMap[episode.id];
    if (!current) return;
    await rateEpisode(episode.id, value, current.feeling);
    setWatchedMap((prev) => ({ ...prev, [episode.id]: { ...current, rating: value } }));
  }

  async function shareEpisode(episode: TVMazeEpisode) {
    const code = `S${String(episode.season).padStart(2, "0")}E${String(episode.number).padStart(2, "0")}`;
    const showName = show?.name ? `${show.name} — ` : "";
    await Share.share({ message: `${showName}${code} · ${episode.name}` });
  }

  async function setFeeling(episode: TVMazeEpisode, key: string) {
    const current = watchedMap[episode.id];
    if (!current) return;
    const next = current.feeling === key ? null : key;
    await rateEpisode(episode.id, current.rating, next);
    setWatchedMap((prev) => ({ ...prev, [episode.id]: { ...current, feeling: next } }));
  }

  const watchedCount = Object.values(watchedMap).filter(Boolean).length;
  const remaining = episodes.length > 0 ? episodes.length - watchedCount : null;

  if (loading || episodes.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.black} />
      </View>
    );
  }

  let dotStart = Math.max(0, currentIndex - Math.floor(MAX_DOTS / 2));
  const dotEnd = Math.min(episodes.length, dotStart + MAX_DOTS);
  dotStart = Math.max(0, dotEnd - MAX_DOTS);
  const dotIndices = Array.from({ length: dotEnd - dotStart }, (_, i) => dotStart + i);

  return (
    <View style={styles.container}>
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.overlayTopRow}>
          <Pressable style={styles.iconBtn} onPress={() => router.replace("/(tabs)")}>
            <Ionicons name="chevron-down" size={22} color="#fff" />
          </Pressable>
          <View style={styles.dotsRow}>
            {dotIndices.map((i) => (
              <View key={i} style={[styles.dot, i === currentIndex && styles.dotActive]} />
            ))}
          </View>
          <Pressable style={styles.iconBtn} onPress={() => shareEpisode(episodes[currentIndex])}>
            <Ionicons name="share-outline" size={20} color="#fff" />
          </Pressable>
        </View>
        {show && (
          <Pressable style={styles.showPill} onPress={() => router.push(`/show/${show.id}`)}>
            <Text style={styles.showPillText}>{show.name.toUpperCase()}</Text>
            <Ionicons name="chevron-forward" size={12} color="#111" />
          </Pressable>
        )}
      </View>

      <FlatList
        ref={listRef}
        data={episodes}
        keyExtractor={(ep) => String(ep.id)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_data, index) => ({ length: width, offset: width * index, index })}
        onScroll={onScroll}
        scrollEventThrottle={16}
        renderItem={({ item: episode }) => (
          <EpisodePage
            episode={episode}
            showId={showIdNum}
            cast={cast}
            width={width}
            watched={watchedMap[episode.id] ?? null}
            remaining={remaining}
            spoilerMode={spoilerMode}
            onToggleWatched={() => toggleWatched(episode)}
            onRewatch={() => rewatchEpisode(episode)}
            onRate={(n) => setRating(episode, n)}
            onFeeling={(key) => setFeeling(episode, key)}
            colors={colors}
            styles={styles}
            t={t}
          />
        )}
      />
      {!positioned && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={colors.black} />
        </View>
      )}
    </View>
  );
}

type EpisodeStyles = ReturnType<typeof createStyles>;

function EpisodePage({
  episode,
  showId,
  cast,
  width,
  watched,
  remaining,
  spoilerMode,
  onToggleWatched,
  onRewatch,
  onRate,
  onFeeling,
  colors,
  styles,
  t,
}: {
  episode: TVMazeEpisode;
  showId: number;
  cast: CastMember[];
  width: number;
  watched: WatchedEpisode | null;
  remaining: number | null;
  spoilerMode: boolean;
  onToggleWatched: () => void;
  onRewatch: () => void;
  onRate: (value: number) => void;
  onFeeling: (key: string) => void;
  colors: Colors;
  styles: EpisodeStyles;
  t: Translations;
}) {
  const bodyIn = useMountIn();
  const unlocked = !!watched || spoilerMode;

  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [comments, setComments] = useState<EnrichedComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [feelingCounts, setFeelingCounts] = useState<Record<string, number>>({});
  const [voteTally, setVoteTally] = useState<CharacterVoteTally[]>([]);
  const [myCharacterId, setMyCharacterId] = useState<number | null>(null);

  // Comments/votes/feelings are spoiler-sensitive, same as the rest of this
  // gated section — nothing is fetched until the episode is actually unlocked.
  useEffect(() => {
    if (!unlocked) return;
    let active = true;
    supabase.auth.getUser().then(({ data }) => active && setMyUserId(data.user?.id ?? null));
    setCommentsLoading(true);
    fetchEpisodeComments(episode.id)
      .then((data) => active && setComments(data))
      .finally(() => active && setCommentsLoading(false));
    fetchEpisodeFeelingCounts(episode.id).then((data) => active && setFeelingCounts(data));
    fetchCharacterVotes(episode.id).then(({ tally, myCharacterId: mine }) => {
      if (!active) return;
      setVoteTally(tally);
      setMyCharacterId(mine);
    });
    return () => {
      active = false;
    };
  }, [unlocked, episode.id]);

  async function handlePostComment(body: string) {
    await postEpisodeComment(showId, episode.id, body);
    setComments(await fetchEpisodeComments(episode.id));
  }

  function handleDeleteComment(id: string) {
    setComments((prev) => prev.filter((c) => c.id !== id));
    deleteComment(id).catch(() => fetchEpisodeComments(episode.id).then(setComments));
  }

  function handleToggleReaction(id: string, currentlyReacted: boolean) {
    setComments((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, reactedByMe: !currentlyReacted, reactionCount: c.reactionCount + (currentlyReacted ? -1 : 1) }
          : c
      )
    );
    toggleCommentReaction(id, currentlyReacted).catch(() => fetchEpisodeComments(episode.id).then(setComments));
  }

  async function handleVote(member: CastMember) {
    const choice = {
      personId: member.person.id,
      personName: member.person.name,
      personImage: member.person.image?.medium ?? null,
      characterId: member.character.id,
      characterName: member.character.name,
    };
    setMyCharacterId(member.character.id);
    await voteForCharacter(showId, episode.id, choice);
    setVoteTally((await fetchCharacterVotes(episode.id)).tally);
  }

  async function handleRemoveVote() {
    setMyCharacterId(null);
    await removeCharacterVote(episode.id);
    setVoteTally((await fetchCharacterVotes(episode.id)).tally);
  }

  return (
    <ScrollView style={{ width }} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        {episode.image ? (
          <Image source={{ uri: episode.image.original }} style={styles.heroImage} />
        ) : (
          <View style={[styles.heroImage, { backgroundColor: colors.backgroundAlt }]} />
        )}
        <LinearGradient
          colors={["transparent", colors.background]}
          style={styles.heroGradient}
          pointerEvents="none"
        />
        <View style={styles.heroBottom}>
          <Text style={styles.code}>
            S{String(episode.season).padStart(2, "0")} · E{String(episode.number).padStart(2, "0")}
          </Text>
          <Text style={styles.title}>{episode.name}</Text>
        </View>
      </View>

      <Animated.View style={[styles.sheet, { opacity: bodyIn.opacity, transform: bodyIn.transform }]}>
        {remaining !== null && (
          <View style={styles.remainingBadge}>
            <Ionicons name="film-outline" size={13} color={colors.accent} />
            <Text style={styles.remainingText}>
              {remaining === 0 ? t.episodeDetail.remainingAll : t.episodeDetail.remaining(remaining)}
            </Text>
          </View>
        )}

        <View style={styles.metaRow}>
          <View style={styles.metaStack}>
            <View style={styles.metaItem}>
              <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
              <Text style={styles.metaText}>{episode.airdate}</Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="eye-outline" size={14} color={colors.textMuted} />
              <Text style={styles.metaText}>
                {watched ? watched.watched_at?.slice(0, 10) : t.episodeDetail.notWatched}
              </Text>
            </View>
          </View>
          <WatchedCheck
            watched={!!watched}
            timesWatched={watched?.times_watched}
            onToggle={onToggleWatched}
            onRewatch={onRewatch}
            size={40}
          />
        </View>

        {episode.summary && <Text style={styles.summary}>{stripHtml(episode.summary)}</Text>}

        {!watched && (
          <>
            <View style={styles.divider} />
            <View style={styles.unwatchedPrompt}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.textFaint} />
              <Text style={styles.unwatchedPromptText}>{t.episodeDetail.unwatchedPrompt}</Text>
            </View>
          </>
        )}

        {watched && (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>{t.episodeDetail.yourRating}</Text>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <RatingStar
                  key={n}
                  index={n}
                  filled={!!(watched?.rating && watched.rating >= n)}
                  onPress={() => onRate(n)}
                  colors={colors}
                  styles={styles}
                />
              ))}
            </View>

            <Text style={styles.sectionLabel}>{t.episodeDetail.howDidYouFeel}</Text>
            <View style={styles.feelingsRow}>
              {FEELING_EMOJIS.map((f) => (
                <FeelingChip
                  key={f.key}
                  emoji={f.emoji}
                  label={t.feelings[f.key]}
                  active={watched?.feeling === f.key}
                  onPress={() => onFeeling(f.key)}
                  colors={colors}
                  styles={styles}
                />
              ))}
            </View>
          </>
        )}

        {unlocked && (
          <>
            {cast.length > 0 && (
              <>
                <View style={styles.divider} />
                <CharacterVote
                  cast={cast}
                  tally={voteTally}
                  myCharacterId={myCharacterId}
                  onVote={handleVote}
                  onRemoveVote={handleRemoveVote}
                />
              </>
            )}

            {Object.keys(feelingCounts).length > 0 && (
              <>
                <View style={styles.divider} />
                <Text style={styles.sectionLabel}>{t.episodeDetail.othersFelt}</Text>
                <View style={styles.feelingsRow}>
                  {FEELING_EMOJIS.filter((f) => feelingCounts[f.key] > 0).map((f) => (
                    <View key={f.key} style={styles.feelingTally}>
                      <Text style={styles.feelingEmoji}>{f.emoji}</Text>
                      <Text style={styles.feelingTallyCount}>{feelingCounts[f.key]}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>{t.episodeDetail.comments}</Text>
            <CommentsSection
              comments={comments}
              loading={commentsLoading}
              myUserId={myUserId}
              onSubmit={handlePostComment}
              onDelete={handleDeleteComment}
              onToggleReaction={handleToggleReaction}
            />
          </>
        )}
      </Animated.View>
    </ScrollView>
  );
}

function RatingStar({
  index,
  filled,
  onPress,
  colors,
  styles,
}: {
  index: number;
  filled: boolean;
  onPress: () => void;
  colors: Colors;
  styles: EpisodeStyles;
}) {
  const { scale, onPressIn, onPressOut } = useScalePress(0.75);

  return (
    <Pressable onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress} style={styles.starCol}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons
          name={filled ? "star" : "star-outline"}
          size={28}
          color={filled ? colors.starOn : colors.starOff}
        />
      </Animated.View>
    </Pressable>
  );
}

function FeelingChip({
  emoji,
  label,
  active,
  onPress,
  colors,
  styles,
}: {
  emoji: string;
  label: string;
  active: boolean;
  onPress: () => void;
  colors: Colors;
  styles: EpisodeStyles;
}) {
  const { scale, onPressIn, onPressOut } = useScalePress(0.88);

  return (
    <Pressable onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress}>
      <Animated.View style={[styles.feelingChip, active && styles.feelingChipActive, { transform: [{ scale }] }]}>
        <Text style={styles.feelingEmoji}>{emoji}</Text>
        <Text style={[styles.feelingLabel, active && { color: colors.accent }]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    zIndex: 20,
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  overlayTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  dotsRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.5)" },
  dotActive: { backgroundColor: colors.accent, width: 18, height: 6, borderRadius: 3 },
  showPill: {
    marginTop: 10,
    marginLeft: 16,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fff",
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  showPillText: { fontSize: 11, fontWeight: "800", color: "#111" },
  page: { flexGrow: 1 },
  hero: { height: 280, backgroundColor: "#111" },
  heroImage: { width: "100%", height: "100%", position: "absolute" },
  heroGradient: { position: "absolute", left: 0, right: 0, bottom: 0, height: 110 },
  heroBottom: { position: "absolute", left: 20, right: 20, bottom: 40 },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: 20,
  },
  code: { color: "rgba(255,255,255,0.85)", fontWeight: "700", fontSize: 13, letterSpacing: 0.3 },
  title: { fontSize: 24, fontWeight: "800", color: "#fff", marginTop: 4 },
  remainingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 16,
  },
  remainingText: { fontSize: 12, fontWeight: "700", color: colors.accent },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  metaStack: { gap: 6 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { color: colors.textMuted, fontSize: 12 },
  summary: { color: colors.text, fontSize: 14, lineHeight: 21 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 20 },
  sectionLabel: {
    textAlign: "center",
    fontWeight: "800",
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  starsRow: { flexDirection: "row", justifyContent: "center", gap: 12, marginBottom: 20 },
  starCol: { alignItems: "center" },
  feelingsRow: { flexDirection: "row", justifyContent: "space-between" },
  feelingChip: { alignItems: "center", gap: 4, padding: 8, borderRadius: radius.sm },
  feelingChipActive: { backgroundColor: colors.accentSoft },
  feelingEmoji: { fontSize: 26 },
  feelingLabel: { fontSize: 9, fontWeight: "700", color: colors.textMuted },
  feelingTally: { alignItems: "center", gap: 4, padding: 8 },
  feelingTallyCount: { fontSize: 12, fontWeight: "700", color: colors.textMuted },
  unwatchedPrompt: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.backgroundAlt,
    borderRadius: radius.md,
    padding: 16,
  },
  unwatchedPromptText: { flex: 1, color: colors.textFaint, fontSize: 13, lineHeight: 18 },
  });
}
