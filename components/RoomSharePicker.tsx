import { useMemo, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { ShareableRoom } from "../lib/rooms";

interface RoomSharePickerProps {
  rooms: ShareableRoom[];
  // Both the selected rooms' ids (so the RPC can scope exactly to them —
  // see mark_episode_watched_for_room's own comment in supabase/schema.sql
  // on why inferring "which room" from the target ids alone was wrong: a
  // caller sharing two rooms with the same person would otherwise also
  // silently write to any OTHER room they happen to share with that
  // person, not just the one(s) actually checked here) and the union of
  // those rooms' other members, pre-deduplicated the same way.
  onShare: (roomIds: string[], userIds: string[]) => void | Promise<void>;
  // For a caller that's already its own dedicated Sheet with nothing else
  // competing for space (see app/show/[id].tsx's season-level share) — the
  // collapse/expand affordance exists to save room alongside other content
  // (the emoji grid in FeelingSheet, the rating section in episode/movie
  // detail), which doesn't apply when the picker *is* the whole sheet.
  defaultExpanded?: boolean;
}

// The actual "share with room" checklist — reused by both FeelingSheet (as
// an extra block in the quick post-watch popup) and RoommateShareRow (the
// always-visible inline version on episode/movie detail). One row per
// *room*, not per person — an earlier version flattened every room's
// members into one person-by-person list, which both lost which room a
// share actually belonged to (see room_watch_log's per-room attribution)
// and, for anyone in more than a couple of rooms, turned into a long list
// of names instead of the handful of rooms they actually belong to.
// Collapsed by default behind a single tappable header, not shown open —
// this is what keeps a tall FeelingSheet (full emoji grid + this block)
// from needing the room list on screen it used to when it was always
// expanded. Nothing is pre-checked either, by explicit request — sharing
// is always a deliberate per-room opt-in, never a default someone has to
// notice and undo.
export function RoomSharePicker({ rooms, onShare, defaultExpanded = false }: RoomSharePickerProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // Guards against the exact bug this shipped to fix: tapping "Share"
  // doesn't visibly do anything on its own (the sheet hosting this is
  // usually closed by the caller the moment onShare resolves — see
  // components/RoomShareToast.tsx), so without disabling immediately a
  // user unsure anything happened would tap again and log the same
  // episode/movie to the room more than once.
  const [state, setState] = useState<"idle" | "sharing" | "shared">("idle");

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleShare() {
    if (state !== "idle" || selected.size === 0) return;
    const selectedRooms = rooms.filter((r) => selected.has(r.id));
    const roomIds = selectedRooms.map((r) => r.id);
    const userIds = [...new Set(selectedRooms.flatMap((r) => r.memberUserIds))];
    setState("sharing");
    try {
      await onShare(roomIds, userIds);
      setState("shared");
      setSelected(new Set());
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("idle");
    }
  }

  return (
    <View>
      <Pressable
        style={styles.header}
        onPress={() => setExpanded((e) => !e)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t.rooms.shareWithRoomDesc}
      >
        <Text style={styles.label}>{t.rooms.shareWithRoomDesc}</Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textFaint} />
      </Pressable>
      {expanded && (
        <>
          {rooms.map((r) => {
            const isSelected = selected.has(r.id);
            return (
              <Pressable
                key={r.id}
                style={styles.row}
                onPress={() => toggle(r.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={r.name}
              >
                <Text style={styles.roomName} numberOfLines={1}>
                  {r.name}
                </Text>
                {/* A fixed-size box around the icon, not the bare Ionicons —
                    an icon-font glyph's own line-height (taller than its
                    visual square) otherwise inflates this row past what's
                    visible, bleeding into — and intercepting taps meant
                    for — whatever sits right below it (found live: the
                    Share button beneath the last row). */}
                <View style={styles.checkIconBox}>
                  <Ionicons
                    name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                    size={22}
                    color={isSelected ? colors.accent : colors.textFaint}
                  />
                </View>
              </Pressable>
            );
          })}
          <Pressable
            style={[styles.shareBtn, (selected.size === 0 || state !== "idle") && styles.shareBtnDisabled]}
            disabled={selected.size === 0 || state !== "idle"}
            onPress={handleShare}
            accessibilityRole="button"
            accessibilityLabel={t.rooms.shareConfirm}
          >
            {state === "sharing" ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={styles.shareBtnText}>{state === "shared" ? t.rooms.shareConfirmed : t.rooms.shareConfirm}</Text>
            )}
          </Pressable>
        </>
      )}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
    label: { fontWeight: "800", fontSize: type.caption, color: colors.textMuted },
    row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, marginTop: 6 },
    roomName: { flex: 1, fontWeight: "700", fontSize: type.body, color: colors.text },
    checkIconBox: { width: 22, height: 22, alignItems: "center", justifyContent: "center" },
    shareBtn: {
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
      paddingVertical: 13,
      alignItems: "center",
      marginTop: 12,
    },
    shareBtnDisabled: { opacity: 0.5 },
    shareBtnText: { color: colors.onAccent, fontWeight: "800", fontSize: type.body },
  });
}
