import { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, Platform, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { Profile } from "../lib/profiles";
import {
  ShareTarget,
  episodeCode,
  copyShareLink,
  shareViaSystem,
  fetchShareCandidates,
  shareWithUsers,
} from "../lib/share";
import { Sheet } from "./Sheet";
import { Avatar } from "./Avatar";

interface ShareSheetProps {
  visible: boolean;
  onClose: () => void;
  target: ShareTarget | null;
}

// Replaces the old bare Share.share text ("Show — S01E02 · Name", no link)
// on the show and episode pages. Two ways out: a real link (copied, or
// handed to the OS share sheet) for anyone, and a direct send to people
// you follow / who follow you, which lands in their notifications (see
// share_with_users in supabase/schema.sql).
export function ShareSheet({ visible, onClose, target }: ShareSheetProps) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      {target && <ShareSheetContent key={shareKey(target)} target={target} onClose={onClose} />}
    </Sheet>
  );
}

function shareKey(target: ShareTarget): string {
  return target.kind === "show" ? `show-${target.showId}` : `episode-${target.episodeId}`;
}

function ShareSheetContent({ target, onClose }: { target: ShareTarget; onClose: () => void }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    fetchShareCandidates()
      .then((p) => active && setPeople(p))
      .catch(() => active && setPeople([]));
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!people) return [];
    const q = query.trim().toLowerCase();
    return q ? people.filter((p) => p.username.toLowerCase().includes(q)) : people;
  }, [people, query]);

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function handleCopy() {
    if (await copyShareLink(target)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function handleSystemShare() {
    // Desktop browsers mostly have no navigator.share — copying is the
    // closest equivalent, so the button still does something useful.
    if (!(await shareViaSystem(target))) await handleCopy();
  }

  async function handleSend() {
    if (sendState === "sending" || selected.size === 0) return;
    setSendState("sending");
    try {
      await shareWithUsers(target, [...selected], message);
      setSendState("sent");
      setTimeout(onClose, 900);
    } catch {
      setSendState("error");
    }
  }

  const subtitle =
    target.kind === "episode" ? `${episodeCode(target.season, target.number)} · ${target.episodeName}` : null;

  return (
    <View>
      <View style={styles.headerRow}>
        {target.showImage ? (
          <Image source={{ uri: target.showImage }} style={styles.poster} contentFit="cover" />
        ) : (
          <View style={[styles.poster, styles.posterPlaceholder]}>
            <Ionicons name="tv-outline" size={18} color={colors.textFaint} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {target.showName}
          </Text>
          {subtitle && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.actionsRow}>
        {Platform.OS === "web" && (
          <Pressable style={styles.actionBtn} onPress={handleCopy} accessibilityRole="button">
            <Ionicons name={copied ? "checkmark" : "link-outline"} size={18} color={copied ? colors.green : colors.text} />
            <Text style={styles.actionText}>{copied ? t.share.linkCopied : t.share.copyLink}</Text>
          </Pressable>
        )}
        <Pressable style={styles.actionBtn} onPress={handleSystemShare} accessibilityRole="button">
          <Ionicons name="share-outline" size={18} color={colors.text} />
          <Text style={styles.actionText}>{t.share.shareVia}</Text>
        </Pressable>
      </View>

      <Text style={styles.sectionLabel}>{t.share.sendToFriends}</Text>

      {people === null ? (
        <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
      ) : people.length === 0 ? (
        <Text style={styles.empty}>{t.share.noFriends}</Text>
      ) : (
        <>
          {people.length > 6 && (
            <TextInput
              style={styles.input}
              placeholder={t.share.searchFriends}
              placeholderTextColor={colors.textFaint}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
          )}
          {filtered.map((p) => {
            const isSelected = selected.has(p.user_id);
            return (
              <Pressable
                key={p.user_id}
                style={styles.personRow}
                onPress={() => toggle(p.user_id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={p.username}
              >
                <Avatar name={p.username} imageUri={p.avatar_url} size="sm" />
                <Text style={styles.personName} numberOfLines={1}>
                  {p.username}
                </Text>
                <View style={styles.checkBox}>
                  <Ionicons
                    name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                    size={22}
                    color={isSelected ? colors.accent : colors.textFaint}
                  />
                </View>
              </Pressable>
            );
          })}

          {selected.size > 0 && (
            <>
              <TextInput
                style={[styles.input, styles.messageInput]}
                placeholder={t.share.messagePlaceholder}
                placeholderTextColor={colors.textFaint}
                value={message}
                onChangeText={setMessage}
                maxLength={300}
                multiline
              />
              <Pressable
                style={[styles.sendBtn, sendState === "sent" && styles.sendBtnDone]}
                onPress={handleSend}
                disabled={sendState === "sending" || sendState === "sent"}
                accessibilityRole="button"
              >
                {sendState === "sending" ? (
                  <ActivityIndicator color={colors.onAccent} />
                ) : (
                  <Text style={styles.sendText}>
                    {sendState === "sent" ? t.share.sent : t.share.send(selected.size)}
                  </Text>
                )}
              </Pressable>
              {sendState === "error" && <Text style={styles.error}>{t.share.sendFailed}</Text>}
            </>
          )}
        </>
      )}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    headerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 },
    poster: { width: 40, height: 56, borderRadius: radius.sm, backgroundColor: colors.backgroundAlt },
    posterPlaceholder: { alignItems: "center", justifyContent: "center" },
    title: { fontSize: type.subtitle, fontWeight: "800", color: colors.text },
    subtitle: { fontSize: type.bodySm, color: colors.textMuted, marginTop: 2 },
    actionsRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
    actionBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 12,
      borderRadius: radius.md,
      backgroundColor: colors.backgroundAlt,
    },
    actionText: { fontSize: type.bodySm, fontWeight: "700", color: colors.text },
    sectionLabel: { fontSize: type.caption, fontWeight: "800", color: colors.textMuted, letterSpacing: 0.5, marginBottom: 8 },
    empty: { fontSize: type.bodySm, color: colors.textMuted, marginVertical: 8 },
    input: {
      backgroundColor: colors.backgroundAlt,
      borderRadius: radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: type.input,
      color: colors.text,
      marginBottom: 8,
    },
    messageInput: { marginTop: 12, minHeight: 64, textAlignVertical: "top" },
    personRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
    personName: { flex: 1, fontSize: type.body, fontWeight: "700", color: colors.text },
    checkBox: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
    sendBtn: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 13,
      borderRadius: radius.md,
      backgroundColor: colors.accent,
      marginTop: 4,
    },
    sendBtnDone: { backgroundColor: colors.green },
    sendText: { fontSize: type.body, fontWeight: "800", color: colors.onAccent },
    error: { fontSize: type.caption, color: colors.red, textAlign: "center", marginTop: 8 },
  });
}
