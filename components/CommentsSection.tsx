import { useState, useMemo } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { EnrichedComment } from "../lib/comments";

interface CommentsSectionProps {
  comments: EnrichedComment[];
  loading: boolean;
  myUserId: string | null;
  onSubmit: (body: string) => Promise<void>;
  onDelete: (id: string) => void;
  onToggleReaction: (id: string, currentlyReacted: boolean) => void;
}

export function CommentsSection({
  comments,
  loading,
  myUserId,
  onSubmit,
  onDelete,
  onToggleReaction,
}: CommentsSectionProps) {
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();

  async function handleSubmit() {
    const body = text.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      await onSubmit(body);
      setText("");
    } finally {
      setPosting(false);
    }
  }

  return (
    <View>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder={t.comments.placeholder}
          placeholderTextColor={colors.textFaint}
          value={text}
          onChangeText={setText}
          multiline
        />
        <Pressable
          style={[styles.sendBtn, (!text.trim() || posting) && styles.sendBtnDisabled]}
          onPress={handleSubmit}
          disabled={!text.trim() || posting}
        >
          {posting ? (
            <ActivityIndicator size="small" color={colors.onAccent} />
          ) : (
            <Ionicons name="send" size={15} color={colors.onAccent} />
          )}
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.textFaint} style={{ marginTop: 16 }} />
      ) : comments.length === 0 ? (
        <Text style={styles.empty}>{t.comments.empty}</Text>
      ) : (
        comments.map((c) => (
          <View key={c.id} style={styles.commentRow}>
            <View style={styles.commentHeader}>
              <Text style={styles.commentAuthor} numberOfLines={1}>
                {c.author?.username ?? t.comments.unknownUser}
              </Text>
              <Text style={styles.commentDate}>{c.created_at.slice(0, 10)}</Text>
              {c.user_id === myUserId && (
                <Pressable onPress={() => onDelete(c.id)} hitSlop={8} style={styles.deleteBtn}>
                  <Ionicons name="trash-outline" size={14} color={colors.textFaint} />
                </Pressable>
              )}
            </View>
            <Text style={styles.commentBody}>{c.body}</Text>
            <Pressable
              style={styles.reactionBtn}
              onPress={() => onToggleReaction(c.id, c.reactedByMe)}
              hitSlop={8}
            >
              <Ionicons
                name={c.reactedByMe ? "heart" : "heart-outline"}
                size={14}
                color={c.reactedByMe ? colors.red : colors.textFaint}
              />
              {c.reactionCount > 0 && (
                <Text style={[styles.reactionCount, c.reactedByMe && { color: colors.red }]}>
                  {c.reactionCount}
                </Text>
              )}
            </Pressable>
          </View>
        ))
      )}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 16 },
    input: {
      flex: 1,
      minHeight: 40,
      maxHeight: 100,
      backgroundColor: colors.backgroundAlt,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: colors.text,
      fontSize: 14,
    },
    sendBtn: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    sendBtnDisabled: { opacity: 0.4 },
    empty: { color: colors.textMuted, textAlign: "center", paddingVertical: 20 },
    commentRow: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: 12,
      marginBottom: 10,
    },
    commentHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
    commentAuthor: { flex: 1, fontWeight: "800", fontSize: 13, color: colors.text },
    commentDate: { fontSize: 11, color: colors.textFaint },
    deleteBtn: { padding: 2 },
    commentBody: { color: colors.text, fontSize: 13, lineHeight: 19, marginTop: 6 },
    reactionBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8, alignSelf: "flex-start" },
    reactionCount: { fontSize: 12, fontWeight: "700", color: colors.textFaint },
  });
}
