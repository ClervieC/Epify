import { useMemo } from "react";
import { View, StyleSheet } from "react-native";
import { useColors, Colors } from "../lib/theme";
import { ShareableRoom } from "../lib/rooms";
import { RoomSharePicker } from "./RoomSharePicker";

interface RoommateShareRowProps {
  rooms: ShareableRoom[];
  onShare: (roomIds: string[], userIds: string[]) => void;
}

// The always-visible counterpart to FeelingSheet's room-share block — for
// episode detail (app/episode/[id].tsx) and movie detail (components/
// MovieRatingSection.tsx), whose "How did it make you feel?" section is
// already on the page (not a popup) and isn't gated by show_feeling_prompt,
// so this needs no visibility condition beyond "is the viewer in any
// rooms." No section label of its own — RoomSharePicker's own tappable
// header already says what this is.
export function RoommateShareRow({ rooms, onShare }: RoommateShareRowProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (rooms.length === 0) return null;

  return (
    <>
      <View style={styles.divider} />
      <RoomSharePicker rooms={rooms} onShare={onShare} />
    </>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 16 },
  });
}
