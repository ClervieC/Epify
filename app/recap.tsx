import { useCallback, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet, Platform } from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { captureRef } from "react-native-view-shot";
import {
  computeRecap,
  isRecapAvailable,
  maxViewableYear,
  defaultRecapMonth,
  lastViewableMonth,
  RecapData,
  RecapPeriod,
} from "../lib/recap";
import { shareRecapImage, shareRecapText } from "../lib/shareImage";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { useGoBack } from "../lib/useGoBack";
import { EmptyState } from "../components/EmptyState";
import { RecapShareCard } from "../components/RecapShareCard";

function formatHours(minutes: number): string {
  return Math.round(minutes / 60).toLocaleString();
}

type RecapMode = "year" | "month";

export default function RecapScreen() {
  // Profile's Year "Wrapped" banner and Social's Monthly recap banner (see
  // app/(tabs)/profile.tsx and app/(tabs)/activity.tsx) each pass their own
  // mode/back explicitly, so tapping either one always lands on the tab it
  // actually promised rather than whatever isRecapAvailable's seasonal
  // window happens to default to at that moment.
  const params = useLocalSearchParams<{ mode?: string; back?: string }>();
  const goBack = useGoBack(params.back === "social" ? "/(tabs)/activity" : "/(tabs)/profile");
  const router = useRouter();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t, language } = useLanguage();
  const now = useMemo(() => new Date(), []);

  // Falls back to the old isRecapAvailable-based guess only when opened
  // with no explicit mode (e.g. a direct/bookmarked link to /recap).
  const [mode, setMode] = useState<RecapMode>(() =>
    params.mode === "year" || params.mode === "month" ? params.mode : isRecapAvailable() ? "year" : "month",
  );
  // Defaults to, and can never browse forward past, maxViewableYear — the
  // current calendar year is only ever reachable during its own seasonal
  // window (see lib/recap.ts's own comment on why), every year before that
  // is always viewable regardless of today's date.
  const maxYear = useMemo(() => maxViewableYear(now), [now]);
  const [year, setYear] = useState(maxYear);
  const isAtMaxYear = year >= maxYear;
  // First-of-month Date for the currently selected month, independent of
  // `year` above (Year mode and Month mode browse their own axis). Defaults
  // to, and can never browse forward past, lastViewableMonth — the current,
  // still-in-progress month is deliberately never shown (see its own
  // comment in lib/recap.ts).
  const maxMonth = useMemo(() => lastViewableMonth(now), [now]);
  const [monthDate, setMonthDate] = useState(() => defaultRecapMonth(now));
  const isAtMaxMonth = monthDate.getFullYear() === maxMonth.getFullYear() && monthDate.getMonth() === maxMonth.getMonth();

  const period: RecapPeriod = useMemo(
    () =>
      mode === "year"
        ? { kind: "year", year }
        : { kind: "month", year: monthDate.getFullYear(), month: monthDate.getMonth() },
    [mode, year, monthDate],
  );
  const periodLabel = useMemo(
    () =>
      mode === "year"
        ? String(year)
        : monthDate.toLocaleDateString(language === "fr" ? "fr-FR" : "en-US", { month: "long", year: "numeric" }),
    [mode, year, monthDate, language],
  );

  const [recap, setRecap] = useState<RecapData | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      computeRecap(period)
        .then((data) => active && setRecap(data))
        .finally(() => active && setLoading(false));
      return () => {
        active = false;
      };
      // period's own identity changes each render (a fresh object literal
      // above) — its pieces are what should actually trigger a refetch.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, year, monthDate]),
  );

  const hasAnything = !!recap && (recap.totalEpisodesWatched > 0 || recap.totalMoviesWatched > 0);
  const topShow = recap?.topShows[0] ?? null;

  // The off-screen RecapShareCard (below, in the JSX) that gets captured —
  // kept mounted (just positioned off-screen) rather than mounted on demand
  // when Share is tapped, so there's no "mount, wait a frame for layout,
  // then capture" race: by the time anyone can tap Share, it's already laid
  // out and ready to snapshot instantly.
  const shareCardRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);

  function shareTextLines(): string[] {
    if (!recap) return [];
    return [
      t.recap.shareTitle(periodLabel),
      t.recap.totalWatchTime(formatHours(recap.totalWatchTimeMinutes)),
      t.recap.episodeCount(recap.totalEpisodesWatched),
      t.recap.movieCount(recap.totalMoviesWatched),
      mode === "year"
        ? topShow
          ? t.recap.topShowLine(topShow.name)
          : null
        : recap.topShows.length > 0
          ? t.recap.topShowsLine(recap.topShows.map((s) => s.name).join(", "))
          : null,
      recap.topGenre ? t.recap.topGenreLine(recap.topGenre) : null,
    ].filter((line): line is string => Boolean(line));
  }

  async function handleShare() {
    if (!recap || sharing) return;
    setSharing(true);
    try {
      const fileName = `epify-recap-${mode === "year" ? year : `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`}.png`;
      const uri = await captureRef(shareCardRef, {
        format: "png",
        quality: 1,
        // react-native-view-shot's web implementation only ever produces a
        // data URI regardless of `result` (there's no tmpfile concept in a
        // browser) — asking for it explicitly skips its own console warning
        // about that. Native keeps the default tmpfile (a real file URI,
        // which is what Sharing.shareAsync needs — see lib/shareImage.ts).
        result: Platform.OS === "web" ? "data-uri" : "tmpfile",
      });
      await shareRecapImage(uri, fileName);
    } catch {
      // Capturing or sharing the image failed outright (a poster still
      // mid-load, an unsupported browser with no download fallback path
      // either, ...) — falling back to the original plain-text share means
      // tapping Share never just silently does nothing.
      await shareRecapText(shareTextLines()).catch(() => {});
    } finally {
      setSharing(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.modeTabs}>
          <Pressable
            style={[styles.modeTabBtn, mode === "year" && styles.modeTabBtnActive]}
            onPress={() => setMode("year")}
          >
            <Text style={[styles.modeTabText, mode === "year" && styles.modeTabTextActive]}>{t.recap.modeYear}</Text>
          </Pressable>
          <Pressable
            style={[styles.modeTabBtn, mode === "month" && styles.modeTabBtnActive]}
            onPress={() => setMode("month")}
          >
            <Text style={[styles.modeTabText, mode === "month" && styles.modeTabTextActive]}>
              {t.recap.modeMonth}
            </Text>
          </Pressable>
        </View>
        <Pressable
          onPress={handleShare}
          hitSlop={10}
          disabled={!hasAnything || sharing}
          accessibilityRole="button"
          accessibilityLabel="Share"
        >
          {sharing ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Ionicons name="share-outline" size={22} color={hasAnything ? colors.text : colors.pillBg} />
          )}
        </Pressable>
      </View>

      {/* Off-screen, always mounted while there's data to show — see
          shareCardRef's own comment above for why it isn't mounted on
          demand instead. */}
      {recap && (
        <View style={styles.offscreenShareCard} pointerEvents="none">
          <RecapShareCard ref={shareCardRef} periodLabel={periodLabel} recap={recap} mode={mode} t={t} />
        </View>
      )}

      <View style={styles.periodSwitch}>
        <Pressable
          onPress={() => (mode === "year" ? setYear((y) => y - 1) : setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1)))}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Previous period"
        >
          <Ionicons name="chevron-back" size={16} color={colors.textFaint} />
        </Pressable>
        <Text style={styles.periodLabel}>{periodLabel}</Text>
        <Pressable
          onPress={() => {
            if (mode === "year") {
              if (!isAtMaxYear) setYear((y) => y + 1);
            } else if (!isAtMaxMonth) {
              setMonthDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
            }
          }}
          hitSlop={8}
          disabled={mode === "year" ? isAtMaxYear : isAtMaxMonth}
          accessibilityRole="button"
          accessibilityLabel="Next period"
        >
          <Ionicons
            name="chevron-forward"
            size={16}
            color={(mode === "year" ? isAtMaxYear : isAtMaxMonth) ? colors.pillBg : colors.textFaint}
          />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.black} style={{ marginTop: 24 }} />
      ) : !hasAnything ? (
        <EmptyState icon="sparkles-outline" title={t.recap.empty(periodLabel)} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.heroCard, { backgroundColor: colors.accent }]}>
            <Ionicons name="sparkles" size={22} color={colors.onAccent} />
            <Text style={[styles.heroValue, { color: colors.onAccent }]}>
              {formatHours(recap!.totalWatchTimeMinutes)}h
            </Text>
            <Text style={[styles.heroLabel, { color: colors.onAccent }]}>{t.recap.watchTimeLabel}</Text>
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{recap!.totalEpisodesWatched.toLocaleString()}</Text>
              <Text style={styles.statLabel}>{t.recap.episodesLabel}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{recap!.totalMoviesWatched.toLocaleString()}</Text>
              <Text style={styles.statLabel}>{t.recap.moviesLabel}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{recap!.newShowsStarted.toLocaleString()}</Text>
              <Text style={styles.statLabel}>{t.recap.newShowsLabel}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{recap!.daysActive.toLocaleString()}</Text>
              <Text style={styles.statLabel}>{t.recap.daysActiveLabel}</Text>
            </View>
          </View>

          {mode === "year" ? (
            topShow && (
              <Pressable style={styles.card} onPress={() => router.push(`/show/${topShow.showId}`)}>
                <Text style={styles.cardLabel}>{t.recap.topShowLabel}</Text>
                <View style={styles.topShowRow}>
                  {topShow.image ? (
                    <Image source={{ uri: topShow.image }} style={styles.topShowImage} contentFit="cover" />
                  ) : (
                    <View style={[styles.topShowImage, { backgroundColor: colors.pillBg }]} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.topShowName}>{topShow.name}</Text>
                    <Text style={styles.cardSubtitle}>{t.showStats.episodeCount(topShow.episodeCount)}</Text>
                  </View>
                </View>
              </Pressable>
            )
          ) : (
            recap!.topShows.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>{t.recap.topShowsLabel}</Text>
                {recap!.topShows.map((show, index) => (
                  <Pressable
                    key={show.showId}
                    style={[styles.rankRow, index > 0 && styles.rankRowBorder]}
                    onPress={() => router.push(`/show/${show.showId}`)}
                  >
                    <Text style={styles.rankNumber}>{index + 1}</Text>
                    {show.image ? (
                      <Image source={{ uri: show.image }} style={styles.rankImage} contentFit="cover" />
                    ) : (
                      <View style={[styles.rankImage, { backgroundColor: colors.pillBg }]} />
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.topShowName} numberOfLines={1}>
                        {show.name}
                      </Text>
                      <Text style={styles.cardSubtitle}>{t.showStats.episodeCount(show.episodeCount)}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )
          )}

          {recap!.topGenre && (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>{t.recap.topGenreLabel}</Text>
              <Text style={styles.topGenreValue}>{recap!.topGenre}</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    // Keeps RecapShareCard laid out (and so instantly capturable — see
    // shareCardRef's comment) without it being visible or intercepting any
    // touches; position:absolute pulls it out of layout flow entirely, so
    // the large negative offset never affects anything else on screen.
    offscreenShareCard: { position: "absolute", top: 0, left: -9999 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 12,
    },
    modeTabs: { flexDirection: "row", backgroundColor: colors.pillBg, borderRadius: radius.pill, padding: 3 },
    modeTabBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.pill },
    modeTabBtnActive: { backgroundColor: colors.accent },
    modeTabText: { fontSize: 13, fontWeight: "700", color: colors.textFaint },
    modeTabTextActive: { color: colors.onAccent },
    periodSwitch: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      paddingBottom: 12,
    },
    periodLabel: { fontSize: type.title, fontWeight: "800", color: colors.text, textTransform: "capitalize" },
    content: { padding: 16, paddingBottom: 40, gap: 14 },
    heroCard: { borderRadius: radius.lg, padding: 24, alignItems: "center", gap: 6 },
    heroValue: { fontSize: 40, fontWeight: "800" },
    heroLabel: { fontSize: type.body, fontWeight: "700", opacity: 0.9 },
    statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    statCard: {
      flexBasis: "47%",
      flexGrow: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      alignItems: "center",
      gap: 4,
    },
    statValue: { fontSize: type.display, fontWeight: "800", color: colors.text },
    statLabel: { fontSize: type.caption, color: colors.textMuted, fontWeight: "700", textAlign: "center" },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
    },
    cardLabel: { fontSize: type.caption, fontWeight: "800", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
    cardSubtitle: { fontSize: type.caption, color: colors.textFaint, marginTop: 2 },
    topShowRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 },
    topShowImage: { width: 56, height: 80, borderRadius: radius.sm },
    topShowName: { fontSize: type.subtitle, fontWeight: "800", color: colors.text },
    topGenreValue: { fontSize: type.title, fontWeight: "800", color: colors.text, marginTop: 6 },
    // Top-5 list rows (Month mode only) — a lighter-weight version of
    // topShowRow above, with a rank number and a smaller poster since up to
    // 5 of these stack in one card instead of just the one.
    rankRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
    rankRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
    rankNumber: { width: 20, fontSize: type.body, fontWeight: "800", color: colors.textFaint, textAlign: "center" },
    rankImage: { width: 40, height: 56, borderRadius: radius.sm },
  });
}
