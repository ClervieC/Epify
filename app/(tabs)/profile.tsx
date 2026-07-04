import { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, TextInput, Alert, ActivityIndicator, Platform } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { createList, fetchAllListItems, fetchFavorites, fetchLists, fetchUserShows, ListItem, ShowList, UserShow } from "../../lib/userShows";
import { importTvTimeCsv, importTvTimeJson, ImportProgress } from "../../lib/tvtimeImport";
import { useColors, radius, Colors } from "../../lib/theme";
import { ShowCard } from "../../components/ShowCard";

const AVG_EPISODE_MINUTES = 42;

function formatTvTime(totalMinutes: number) {
  const totalHours = Math.floor(totalMinutes / 60);
  const months = Math.floor(totalHours / (24 * 30));
  const days = Math.floor((totalHours % (24 * 30)) / 24);
  const hours = totalHours % 24;
  return { months, days, hours };
}

export default function ProfileScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const [shows, setShows] = useState<UserShow[]>([]);
  const [favorites, setFavorites] = useState<UserShow[]>([]);
  const [lists, setLists] = useState<ShowList[]>([]);
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [episodeCount, setEpisodeCount] = useState(0);
  const [creatingList, setCreatingList] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const load = useCallback(() => {
    fetchUserShows().then(setShows);
    fetchFavorites().then(setFavorites);
    fetchLists().then(setLists);
    fetchAllListItems().then(setListItems);
    supabase
      .from("watched_episodes")
      .select("id", { count: "exact", head: true })
      .then(({ count }) => setEpisodeCount(count ?? 0));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleCreateList() {
    if (!newListName.trim()) return;
    await createList(newListName.trim());
    setNewListName("");
    setCreatingList(false);
    fetchLists().then(setLists);
  }

  async function handleImportTvTime() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["text/csv", "text/comma-separated-values", "application/json", "*/*"],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    const name = asset.name.toLowerCase();
    const isJson = name.endsWith(".json");
    const isCsv = name.endsWith(".csv");
    if (!isJson && !isCsv) {
      Alert.alert("Fichier invalide", "Choisis un export CSV ou JSON de TV Time.");
      return;
    }

    setImporting(true);
    setImportProgress(null);
    try {
      let text: string;
      if (Platform.OS === "web") {
        if (!asset.file) throw new Error("Impossible de lire le fichier sélectionné.");
        text = await asset.file.text();
      } else {
        text = await new File(asset.uri).text();
      }
      const summary = isJson ? await importTvTimeJson(text, setImportProgress) : await importTvTimeCsv(text, setImportProgress);
      load();

      const unmatchedNote =
        summary.showsUnmatched.length > 0
          ? `\n${summary.showsUnmatched.length} série(s) introuvable(s) sur TVmaze : ${summary.showsUnmatched
              .slice(0, 5)
              .join(", ")}${summary.showsUnmatched.length > 5 ? "…" : ""}`
          : "";

      Alert.alert(
        "Import terminé",
        `${summary.showsImported} série(s) importée(s), ${summary.episodesImported} épisode(s) marqué(s) comme vu(s), ${summary.moviesImported} film(s) importé(s).${unmatchedNote}`
      );
    } catch (e) {
      Alert.alert("Échec de l'import", e instanceof Error ? e.message : "Erreur inconnue.");
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  }

  const username = session?.user.email?.split("@")[0] ?? "Moi";
  const tvTime = formatTvTime(episodeCount * AVG_EPISODE_MINUTES);

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.banner}>
        <Pressable style={styles.bell}>
          <Ionicons name="notifications" size={20} color={colors.onAccent} />
        </Pressable>
        <Pressable style={styles.menuDots}>
          <Ionicons name="ellipsis-horizontal" size={20} color="#fff" />
        </Pressable>
      </View>

      <View style={styles.profileHeader}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={44} color="#fff" />
        </View>
        <Text style={styles.username}>{username}</Text>
        <Pressable style={styles.editButton}>
          <Text style={styles.editButtonText}>EDIT</Text>
        </Pressable>
      </View>

      <View style={styles.statsBar}>
        <View style={styles.statsBarItem}>
          <Text style={styles.statsBarNumber}>11</Text>
          <Text style={styles.statsBarLabel}>following</Text>
        </View>
        <View style={[styles.statsBarItem, styles.statsBarBorder]}>
          <Text style={styles.statsBarNumber}>13</Text>
          <Text style={styles.statsBarLabel}>followers</Text>
        </View>
        <View style={styles.statsBarItem}>
          <Text style={styles.statsBarNumber}>0</Text>
          <Text style={styles.statsBarLabel}>comments</Text>
        </View>
      </View>

      <SectionHeader title="Stats" styles={styles} colors={colors} />
      <View style={styles.statCards}>
        <View style={styles.statCard}>
          <View style={styles.statCardHeader}>
            <Ionicons name="tv-outline" size={16} color={colors.black} />
            <Text style={styles.statCardTitle}>TV time</Text>
          </View>
          <View style={styles.tvTimeRow}>
            <TvTimeUnit value={tvTime.months} label="MONTHS" styles={styles} />
            <TvTimeUnit value={tvTime.days} label="DAYS" styles={styles} />
            <TvTimeUnit value={tvTime.hours} label="HOUR" styles={styles} />
          </View>
        </View>
        <View style={styles.statCard}>
          <View style={styles.statCardHeader}>
            <Ionicons name="tv-outline" size={16} color={colors.black} />
            <Text style={styles.statCardTitle}>Episodes watched</Text>
          </View>
          <Text style={styles.episodesNumber}>{episodeCount.toLocaleString()}</Text>
        </View>
      </View>

      <SectionHeader title="Favorites" styles={styles} colors={colors} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
        {favorites.length === 0 ? (
          <Text style={styles.empty}>Aucun favori pour l'instant.</Text>
        ) : (
          favorites.map((s) => <ShowCard key={s.id} id={s.tvmaze_id} name={s.show_name} imageUrl={s.show_image} />)
        )}
      </ScrollView>

      <SectionHeader title="Lists" styles={styles} colors={colors} />
      {lists.map((list) => {
        const items = listItems.filter((i) => i.list_id === list.id);
        return (
          <Pressable
            key={list.id}
            style={styles.listRow}
            onPress={() => router.push({ pathname: "/list/[id]", params: { id: list.id } })}
          >
            <View style={styles.listRowThumb}>
              <Ionicons name="list-outline" size={20} color={colors.textMuted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.listRowName}>{list.name}</Text>
              <Text style={styles.listRowCount}>
                {items.length} série{items.length > 1 ? "s" : ""}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>
        );
      })}

      {creatingList ? (
        <View style={styles.newListRow}>
          <TextInput
            style={styles.newListInput}
            placeholder="Nom de la liste"
            placeholderTextColor={colors.textFaint}
            value={newListName}
            onChangeText={setNewListName}
            autoFocus
          />
          <Pressable style={styles.newListBtn} onPress={handleCreateList}>
            <Ionicons name="checkmark" size={20} color={colors.onAccent} />
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.createList} onPress={() => setCreatingList(true)}>
          <Ionicons name="add" size={28} color={colors.black} />
          <Text style={styles.createListText}>CREATE A NEW LIST</Text>
        </Pressable>
      )}

      <SectionHeader title="Shows" styles={styles} colors={colors} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.showsRow}>
        {shows.length === 0 ? (
          <Text style={styles.empty}>Aucune série pour l'instant.</Text>
        ) : (
          shows.map((s) => (
            <ShowCard key={s.id} id={s.tvmaze_id} name={s.show_name} imageUrl={s.show_image} />
          ))
        )}
      </ScrollView>

      <SectionHeader title="Réglages" styles={styles} colors={colors} />
      <Pressable style={styles.importRow} onPress={handleImportTvTime} disabled={importing}>
        <Ionicons name="cloud-upload-outline" size={20} color={colors.text} />
        <View style={{ flex: 1 }}>
          <Text style={styles.importRowTitle}>Importer depuis TV Time</Text>
          <Text style={styles.importRowSubtitle}>Charge ton export CSV ou JSON récupéré de TV Time (by Refract) pour récupérer ton historique.</Text>
        </View>
        {importing ? (
          <ActivityIndicator color={colors.black} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        )}
      </Pressable>
      {importing && importProgress && (
        <View style={styles.importProgress}>
          <Text style={styles.importProgressText}>
            {importProgress.phase === "matching" ? "Recherche des séries" : "Import des épisodes"} —{" "}
            {importProgress.current}/{importProgress.total}
          </Text>
          <Text style={styles.importProgressLabel} numberOfLines={1}>
            {importProgress.label}
          </Text>
        </View>
      )}

      <Pressable style={styles.signOut} onPress={() => supabase.auth.signOut()}>
        <Text style={styles.signOutText}>Se déconnecter</Text>
      </Pressable>
    </ScrollView>
  );
}

type ProfileStyles = ReturnType<typeof createStyles>;

function SectionHeader({ title, styles, colors }: { title: string; styles: ProfileStyles; colors: Colors }) {
  return (
    <Pressable style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Ionicons name="chevron-forward" size={20} color={colors.black} />
    </Pressable>
  );
}

function TvTimeUnit({ value, label, styles }: { value: number; label: string; styles: ProfileStyles }) {
  return (
    <View style={styles.tvTimeUnit}>
      <Text style={styles.tvTimeValue}>{value}</Text>
      <Text style={styles.tvTimeLabel}>{label}</Text>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  banner: {
    height: 220,
    backgroundColor: "#2a2a2e",
    justifyContent: "space-between",
    flexDirection: "row",
    padding: 16,
  },
  bell: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  menuDots: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  profileHeader: { paddingHorizontal: 16, marginTop: -50 },
  avatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "#3a3a3e",
    borderWidth: 4,
    borderColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  username: { fontSize: 26, fontWeight: "800", color: colors.text, marginTop: 10 },
  editButton: {
    borderWidth: 1.5,
    borderColor: colors.black,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
    paddingHorizontal: 18,
    paddingVertical: 6,
    marginTop: 10,
  },
  editButtonText: { fontWeight: "700", fontSize: 12, letterSpacing: 0.5 },
  statsBar: {
    flexDirection: "row",
    marginTop: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  statsBarItem: { flex: 1, alignItems: "center" },
  statsBarBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
  statsBarNumber: { fontSize: 22, fontWeight: "800", color: colors.text },
  statsBarLabel: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 12,
  },
  sectionTitle: { fontSize: 22, fontWeight: "800", color: colors.text },
  statCards: { flexDirection: "row", gap: 12, paddingHorizontal: 16 },
  statCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  statCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statCardTitle: { fontWeight: "700", fontSize: 13, color: colors.text },
  tvTimeRow: { flexDirection: "row", padding: 12, gap: 8 },
  tvTimeUnit: { alignItems: "center", flex: 1 },
  tvTimeValue: { fontSize: 22, fontWeight: "800", color: colors.text },
  tvTimeLabel: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  episodesNumber: { fontSize: 30, fontWeight: "800", color: colors.text, padding: 16, textAlign: "center" },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  listRowThumb: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.backgroundAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  listRowName: { fontWeight: "700", fontSize: 14, color: colors.text },
  listRowCount: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  newListRow: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginTop: 12 },
  newListInput: {
    flex: 1,
    backgroundColor: colors.backgroundAlt,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 14,
  },
  newListBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  createList: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: colors.backgroundAlt,
    borderRadius: radius.md,
    paddingVertical: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  createListText: { fontWeight: "800", fontSize: 13, letterSpacing: 0.5, color: colors.text },
  showsRow: { paddingHorizontal: 16, paddingBottom: 24 },
  empty: { color: colors.textMuted },
  importRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  importRowTitle: { fontWeight: "700", fontSize: 14, color: colors.text },
  importRowSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  importProgress: { marginHorizontal: 16, marginTop: 10 },
  importProgressText: { fontSize: 12, fontWeight: "700", color: colors.text },
  importProgressLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  signOut: { alignItems: "center", paddingVertical: 24 },
  signOutText: { color: colors.red, fontWeight: "600" },
  });
}
