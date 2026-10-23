import { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getPersonDetails, getPersonCombinedCredits, findTvmazeShowFromTmdbTv, profileUrl, posterUrl, TMDBPersonCredit } from "../../lib/tmdb";
import { useColors, radius, type, Colors } from "../../lib/theme";
import { useLanguage } from "../../lib/i18n";
import { alert } from "../../lib/alert";
import { useGoBack } from "../../lib/useGoBack";
import { RecommendationsRow, RecommendationItem } from "../../components/RecommendationsRow";

// An actor's own page — reached by tapping their photo on a show's cast row
// (app/show/[id].tsx, resolved by name via lib/tmdb.ts's searchPerson first
// since TVmaze only knows them by its own person id) or a movie's
// (components/MovieDetailView.tsx, which already carries this same TMDB id
// on each cast member). Shows everything TMDB has credited them in, movies
// and TV shows both — TVmaze alone couldn't answer that, it has no movie
// data at all.
export default function PersonScreen() {
  const { id, name: nameParam } = useLocalSearchParams<{ id: string; name?: string }>();
  const personId = Number(id);
  const goBack = useGoBack("/(tabs)/explore");
  const router = useRouter();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const [name, setName] = useState(nameParam ?? "");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [credits, setCredits] = useState<TMDBPersonCredit[]>([]);
  const [loading, setLoading] = useState(true);
  // The TMDB TV id currently being resolved to a TVmaze show (see
  // resolveAndOpenTv) — a movie opens instantly (its id is already a
  // TVmaze-free route), only a TV credit needs this brief lookup step.
  const [resolvingTvId, setResolvingTvId] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      Promise.all([getPersonDetails(personId), getPersonCombinedCredits(personId)])
        .then(([person, personCredits]) => {
          if (!active) return;
          setName(person.name);
          setPhotoUrl(profileUrl(person.profile_path));
          setCredits(personCredits);
        })
        .finally(() => active && setLoading(false));
      return () => {
        active = false;
      };
    }, [personId])
  );

  async function resolveAndOpenTv(credit: TMDBPersonCredit) {
    setResolvingTvId(credit.id);
    try {
      const resolved = await findTvmazeShowFromTmdbTv(credit.id);
      if (resolved) {
        router.push(`/show/${resolved.id}`);
      } else {
        alert(t.explore.noMatchTitle, t.explore.noMatchDesc);
      }
    } finally {
      setResolvingTvId(null);
    }
  }

  const movieItems: RecommendationItem[] = credits
    .filter((c) => c.mediaType === "movie")
    .map((c) => ({
      key: c.id,
      title: c.title,
      posterUrl: posterUrl(c.posterPath, "w200"),
      onPress: () => router.push(`/movie/tmdb/${c.id}`),
    }));

  const tvItems: RecommendationItem[] = credits
    .filter((c) => c.mediaType === "tv")
    .map((c) => ({
      key: c.id,
      title: c.title,
      posterUrl: posterUrl(c.posterPath, "w200"),
      onPress: () => resolveAndOpenTv(c),
    }));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {name}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 32 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.profileRow}>
            {photoUrl ? (
              <Image source={{ uri: photoUrl }} style={styles.photo} contentFit="cover" />
            ) : (
              <View style={[styles.photo, styles.photoPlaceholder]}>
                <Ionicons name="person" size={32} color={colors.textFaint} />
              </View>
            )}
            <Text style={styles.name}>{name}</Text>
          </View>

          <RecommendationsRow items={movieItems} title={t.person.movies} />
          <RecommendationsRow items={tvItems} title={t.person.tvShows} />

          {movieItems.length === 0 && tvItems.length === 0 && <Text style={styles.empty}>{t.person.noCredits}</Text>}
        </ScrollView>
      )}

      {resolvingTvId !== null && (
        <View style={styles.resolvingOverlay}>
          <ActivityIndicator color={colors.onAccent} />
        </View>
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
    headerTitle: { flex: 1, textAlign: "center", fontSize: type.title, fontWeight: "800", color: colors.text },
    body: { padding: 16, paddingBottom: 32 },
    profileRow: { alignItems: "center", gap: 10, marginBottom: 8 },
    photo: { width: 110, height: 110, borderRadius: radius.pill, backgroundColor: colors.backgroundAlt },
    photoPlaceholder: { alignItems: "center", justifyContent: "center" },
    name: { fontSize: type.title, fontWeight: "800", color: colors.text, textAlign: "center" },
    empty: { color: colors.textMuted, textAlign: "center", marginTop: 24 },
    resolvingOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.25)",
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
