import { forwardRef, useMemo } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { RecapData } from "../lib/recap";
import { Translations } from "../lib/i18n";

// On web, this card gets captured into a PNG via html2canvas (see
// react-native-view-shot's web path, used from app/recap.tsx) — which needs
// to read each <img>'s actual pixels, and silently fails to (leaving that
// one image blank, the rest of the card still renders) for any cross-origin
// image whose server doesn't send Access-Control-Allow-Origin. Verified
// directly: TVmaze's static.tvmaze.com does send it, TMDB's image.tmdb.org
// does not — so only topMovies' TMDB posters need this, not topShows'
// TVmaze ones. wsrv.nl is a free image proxy that re-serves the same image
// with that header added; routing just the ones that need it through it
// avoids needing our own backend for what's otherwise a pure browser
// capture-API limitation. Native is unaffected either way —
// react-native-view-shot captures the real rendered view there, not a
// canvas re-draw of each image's pixels, so CORS never enters into it.
function capturableImageUrl(url: string | null, kind: "show" | "movie"): string | null {
  if (!url || kind === "show" || Platform.OS !== "web") return url;
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}`;
}

// Fixed, story-friendly (9:16) size and a hardcoded dark-purple brand
// palette rather than useColors() — a shared image needs to look right
// regardless of the poster's own light/dark app theme (or Epify's theme
// having since changed), the same reason Spotify Wrapped cards don't follow
// the listener's own system theme either.
const CARD_WIDTH = 360;
const CARD_HEIGHT = 640;
// How many extra poster thumbnails the strip near the bottom shows, beyond
// the one big "featured" poster above it.
const STRIP_COUNT = 4;

interface RecapShareCardProps {
  periodLabel: string;
  recap: RecapData;
  mode: "year" | "month";
  t: Translations;
}

interface FeaturedItem {
  key: string;
  kind: "show" | "movie";
  title: string;
  image: string | null;
}

// Rendered off-screen (see app/recap.tsx) and captured via
// react-native-view-shot's captureRef when the user taps Share — not the
// on-screen stats layout itself, which is sized/laid out for being read in
// the app, not for looking good as a standalone image handed to Instagram/
// X/etc.
export const RecapShareCard = forwardRef<View, RecapShareCardProps>(function RecapShareCard(
  { periodLabel, recap, mode, t },
  ref,
) {
  const hours = Math.round(recap.totalWatchTimeMinutes / 60);

  // One combined, ranked list of every poster this period has to show —
  // shows first (episodeCount already sorted them), then movies — so a
  // period with little or no TV still has real art to feature instead of a
  // flat background and a wall of numbers (the actual complaint this card
  // exists to fix: a stat-only card "c'est nul d'avoir que le texte").
  const allItems: FeaturedItem[] = useMemo(
    () => [
      ...recap.topShows.map((s) => ({
        key: `show-${s.showId}`,
        kind: "show" as const,
        title: s.name,
        image: capturableImageUrl(s.image, "show"),
      })),
      ...recap.topMovies.map((m) => ({
        key: `movie-${m.movieId}`,
        kind: "movie" as const,
        title: m.title,
        image: capturableImageUrl(m.image, "movie"),
      })),
    ],
    [recap],
  );
  // The single best poster, preferring a show (what Year mode's original
  // card always featured) — only falls to a movie when there was no show at
  // all, or the top show has no image but some movie does.
  const featured = allItems.find((i) => i.image) ?? null;
  const posterStrip = allItems.filter((i) => i.image && i.key !== featured?.key).slice(0, STRIP_COUNT);

  return (
    // collapsable={false} keeps Android from flattening this View out of
    // the native view hierarchy since nothing above it needs to visually
    // reference it — without it, view-shot has nothing to actually
    // snapshot on that platform (see its own README on this exact gotcha).
    <View ref={ref} collapsable={false} style={styles.card}>
      {featured?.image ? (
        <>
          {/* A real, blurred poster behind everything rather than a flat
              gradient — low source resolution (the list thumbnails'
              "medium"/"w342" sizes, see lib/recap.ts) is a non-issue here
              since it's blurred anyway, and blurring it is what keeps the
              text on top legible without needing its own solid backing. */}
          <Image source={{ uri: featured.image }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} />
          <LinearGradient
            colors={["rgba(26,16,51,0.55)", "rgba(26,16,51,0.75)", "rgba(20,12,45,0.94)"]}
            style={StyleSheet.absoluteFill}
          />
        </>
      ) : (
        <LinearGradient
          colors={["#2a1a66", "#4a2f9e", "#7c5cff"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View style={styles.content}>
        <View>
          <Text style={styles.eyebrow}>{mode === "year" ? t.recap.modeYear.toUpperCase() : t.recap.modeMonth.toUpperCase()} RECAP</Text>
          <Text style={styles.periodLabel}>{periodLabel}</Text>
        </View>

        <View style={styles.hero}>
          <Text style={styles.heroValue}>{hours}h</Text>
          <Text style={styles.heroLabel}>{t.recap.watchTimeLabel}</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBlock}>
            <Text style={styles.statValue}>{recap.totalEpisodesWatched.toLocaleString()}</Text>
            <Text style={styles.statLabel}>{t.recap.episodesLabel}</Text>
          </View>
          <View style={styles.statBlock}>
            <Text style={styles.statValue}>{recap.totalMoviesWatched.toLocaleString()}</Text>
            <Text style={styles.statLabel}>{t.recap.moviesLabel}</Text>
          </View>
        </View>

        {featured && (
          <View style={styles.featuredRow}>
            {featured.image ? (
              <Image source={{ uri: featured.image }} style={styles.featuredImage} contentFit="cover" />
            ) : (
              <View style={[styles.featuredImage, styles.featuredImagePlaceholder]} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.featuredLabel}>
                {(featured.kind === "show" ? t.recap.topShowLabel : t.recap.topMovieLabel).toUpperCase()}
              </Text>
              <Text style={styles.featuredTitle} numberOfLines={2}>
                {featured.title}
              </Text>
            </View>
          </View>
        )}

        {posterStrip.length > 0 && (
          <View style={styles.posterStrip}>
            {posterStrip.map((item) => (
              <Image key={item.key} source={{ uri: item.image! }} style={styles.stripImage} contentFit="cover" />
            ))}
          </View>
        )}

        <View style={styles.brandRow}>
          <Image source={require("../assets/logo.png")} style={styles.brandLogo} contentFit="cover" />
          <Text style={styles.brandText}>Epify</Text>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    overflow: "hidden",
    borderRadius: 0,
  },
  content: {
    flex: 1,
    padding: 32,
    justifyContent: "space-between",
  },
  eyebrow: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  periodLabel: {
    color: "#fff",
    fontSize: 30,
    fontWeight: "800",
    marginTop: 6,
    textTransform: "capitalize",
  },
  hero: { alignItems: "center" },
  heroValue: { color: "#fff", fontSize: 76, fontWeight: "900" },
  heroLabel: { color: "rgba(255,255,255,0.85)", fontSize: 16, fontWeight: "700", marginTop: 2 },
  statsRow: { flexDirection: "row", justifyContent: "center", gap: 48 },
  statBlock: { alignItems: "center" },
  statValue: { color: "#fff", fontSize: 32, fontWeight: "800" },
  statLabel: { color: "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: "700", marginTop: 2 },
  featuredRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 16,
    padding: 14,
  },
  featuredImage: { width: 48, height: 68, borderRadius: 8 },
  featuredImagePlaceholder: { backgroundColor: "rgba(255,255,255,0.25)" },
  featuredLabel: { color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  featuredTitle: { color: "#fff", fontSize: 17, fontWeight: "800", marginTop: 2 },
  posterStrip: { flexDirection: "row", gap: 8, justifyContent: "center" },
  stripImage: { width: 52, height: 74, borderRadius: 8 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "center" },
  brandLogo: { width: 22, height: 22, borderRadius: 6 },
  brandText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
