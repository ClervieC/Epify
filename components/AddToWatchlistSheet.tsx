import { useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useColors, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { addShowToRoomWatchlist, addMovieToRoomWatchlist } from "../lib/rooms";
import { MediaSearch } from "./MediaSearch";

interface AddToWatchlistSheetProps {
  roomId: string;
  // What's already queued, so search results can show it as added instead
  // of offering a duplicate (the unique indexes would reject it anyway).
  existingShowIds?: Set<number>;
  existingMovieIds?: Set<number>;
  onAdded: () => void;
  onClose: () => void;
}

// Lets a member queue something the room hasn't started yet ("we want to
// watch this together") — unlike AddWatchTogetherSheet, which logs
// something already watched episode by episode, this is just a search and
// a tap: no season/episode picker, nothing marked watched for anyone.
export function AddToWatchlistSheet({ roomId, existingShowIds, existingMovieIds, onAdded, onClose }: AddToWatchlistSheetProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const [adding, setAdding] = useState(false);

  async function add(run: () => Promise<void>) {
    if (adding) return;
    setAdding(true);
    try {
      await run();
      onAdded();
      onClose();
    } finally {
      setAdding(false);
    }
  }

  return (
    <View>
      <Text style={styles.sheetTitle}>{t.rooms.addToWatchlistTitle}</Text>
      <MediaSearch
        disabled={adding}
        existingShowIds={existingShowIds}
        existingMovieIds={existingMovieIds}
        onPickShow={(show) => add(() => addShowToRoomWatchlist(roomId, show))}
        onPickMovie={(movie) => add(() => addMovieToRoomWatchlist(roomId, movie))}
      />
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    sheetTitle: { textAlign: "center", fontWeight: "800", fontSize: 13, color: colors.textMuted, letterSpacing: 0.5, marginBottom: 16 },
  });
}
