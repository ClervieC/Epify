import { useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, Colors, dropShadow } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { alert } from "../lib/alert";
import { Profile } from "../lib/profiles";
import { Avatar } from "./Avatar";
import { EmptyState } from "./EmptyState";
import { ReportModal } from "./ReportModal";

// Structural rather than importing lib/comments.ts's EnrichedComment directly
// — lib/movieComments.ts's EnrichedMovieComment has a different target key
// (tmdb_id vs. tvmaze_show_id/tvmaze_episode_id) but the same shape for
// everything this component actually renders, so either satisfies this.
export interface CommentLike {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  author: Profile | null;
  reactionCount: number;
  reactedByMe: boolean;
  // Null for a top-level comment. One level deep only — a reply is never
  // itself repliable (see ThreadedComment below), so this component never
  // has to deal with a reply's own replies.
  parent_comment_id: string | null;
}

interface CommentsSectionProps {
  comments: CommentLike[];
  loading: boolean;
  myUserId: string | null;
  // parentId is set when replying to a specific comment (see replyingTo
  // state below) — undefined/omitted posts a new top-level comment, exactly
  // as before.
  onSubmit: (body: string, parentId?: string) => Promise<void>;
  onDelete: (id: string) => void;
  onToggleReaction: (id: string, currentlyReacted: boolean) => void;
  // Which reports.ts target column a report on one of these comments should
  // set — "comment" for show/episode comments, "movie_comment" for movie
  // ones (see the shared-shape note on CommentLike above).
  reportTargetType: "comment" | "movie_comment";
}

export function CommentsSection({
  comments,
  loading,
  myUserId,
  onSubmit,
  onDelete,
  onToggleReaction,
  reportTargetType,
}: CommentsSectionProps) {
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState(false);
  const [reportingCommentId, setReportingCommentId] = useState<string | null>(null);
  // The comment being replied to, if any — cleared on a successful post, on
  // explicit cancel, or (implicitly, next render) if that comment is deleted
  // out from under it since it won't be found by id anymore.
  const [replyingTo, setReplyingTo] = useState<{ id: string; author: string } | null>(null);
  // Collapsed by default, like a real feed post's replies — a thread only
  // shows its replies once expanded, either by tapping "View replies" or by
  // tapping "Reply" (see startReply below), rather than every comment
  // dumping its whole thread on screen at once.
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();

  // Top-level comments keep the caller's own order (newest-first, per
  // fetchEpisodeComments/fetchMovieComments etc.); each one's replies are
  // shown oldest-first underneath it, since a reply thread reads as a
  // conversation, not a feed.
  const { topLevel, repliesByParent } = useMemo(() => {
    const top: CommentLike[] = [];
    const byParent = new Map<string, CommentLike[]>();
    for (const c of comments) {
      if (!c.parent_comment_id) {
        top.push(c);
        continue;
      }
      const list = byParent.get(c.parent_comment_id) ?? [];
      list.push(c);
      byParent.set(c.parent_comment_id, list);
    }
    for (const list of byParent.values()) {
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }
    return { topLevel: top, repliesByParent: byParent };
  }, [comments]);

  async function handleSubmit() {
    const body = text.trim();
    if (!body || posting) return;
    setPosting(true);
    setPostError(false);
    try {
      await onSubmit(body, replyingTo?.id);
      setText("");
      setReplyingTo(null);
    } catch {
      setPostError(true);
    } finally {
      setPosting(false);
    }
  }

  function startReply(comment: CommentLike) {
    setReplyingTo({ id: comment.id, author: comment.author?.username ?? t.comments.unknownUser });
    setExpandedThreads((prev) => new Set(prev).add(comment.id));
  }

  function toggleThread(id: string) {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Shared between the top-level composer and the inline reply composer
  // below — only one is ever rendered at a time (see replyingTo), so there's
  // no ambiguity about which one `text`/`posting`/`postError` belong to.
  const composer = (placeholder: string) => (
    <>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          value={text}
          onChangeText={setText}
          multiline
        />
        <Pressable
          style={[styles.sendBtn, (!text.trim() || posting) && styles.sendBtnDisabled]}
          onPress={handleSubmit}
          disabled={!text.trim() || posting}
          accessibilityRole="button"
          accessibilityLabel="Send comment"
        >
          {posting ? (
            <ActivityIndicator size="small" color={colors.onAccent} />
          ) : (
            <Ionicons name="send" size={15} color={colors.onAccent} />
          )}
        </Pressable>
      </View>
      {postError && <Text style={styles.errorText}>{t.comments.postError}</Text>}
    </>
  );

  return (
    <View>
      {/* Always here, in the same place — never repurposed into the reply
          box below, so nothing about this one moves/disappears when you
          tap "Reply" on a comment (that opens its own separate inline
          composer under that thread instead). */}
      {composer(t.comments.placeholder)}

      {loading ? (
        <ActivityIndicator color={colors.textFaint} style={{ marginTop: 16 }} />
      ) : comments.length === 0 ? (
        <EmptyState icon="chatbubble-outline" title={t.comments.empty} />
      ) : (
        topLevel.map((c) => {
          const replies = repliesByParent.get(c.id) ?? [];
          const expanded = expandedThreads.has(c.id);
          return (
            <View key={c.id}>
              <CommentRow
                comment={c}
                myUserId={myUserId}
                onDelete={onDelete}
                onToggleReaction={onToggleReaction}
                onReply={() => startReply(c)}
                onReport={() => setReportingCommentId(c.id)}
                colors={colors}
                styles={styles}
                t={t}
                repliesCount={replies.length}
                repliesExpanded={expanded}
                onToggleReplies={() => toggleThread(c.id)}
              />
              {expanded &&
                replies.map((reply) => (
                  <View key={reply.id} style={styles.replyWrap}>
                    <CommentRow
                      comment={reply}
                      myUserId={myUserId}
                      onDelete={onDelete}
                      onToggleReaction={onToggleReaction}
                      // Replying to a reply isn't supported — see the note on
                      // CommentLike.parent_comment_id — so this reuses startReply
                      // with the *top-level* comment, keeping the thread one
                      // level deep instead of nesting indefinitely.
                      onReply={() => startReply(c)}
                      onReport={() => setReportingCommentId(reply.id)}
                      colors={colors}
                      styles={styles}
                      t={t}
                    />
                  </View>
                ))}
              {replyingTo?.id === c.id && (
                <View style={styles.replyWrap}>
                  <View style={styles.replyingToRow}>
                    <Text style={styles.replyingToText} numberOfLines={1}>
                      {t.comments.replyingTo(replyingTo.author)}
                    </Text>
                    <Pressable onPress={() => setReplyingTo(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel reply">
                      <Ionicons name="close" size={16} color={colors.textFaint} />
                    </Pressable>
                  </View>
                  {composer(t.comments.replyPlaceholder)}
                </View>
              )}
            </View>
          );
        })
      )}
      <ReportModal
        visible={reportingCommentId !== null}
        onClose={() => setReportingCommentId(null)}
        target={
          reportTargetType === "movie_comment"
            ? { targetType: "movie_comment", targetMovieCommentId: reportingCommentId ?? "" }
            : { targetType: "comment", targetCommentId: reportingCommentId ?? "" }
        }
      />
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

function CommentRow({
  comment: c,
  myUserId,
  onDelete,
  onToggleReaction,
  onReply,
  onReport,
  colors,
  styles,
  t,
  repliesCount,
  repliesExpanded,
  onToggleReplies,
}: {
  comment: CommentLike;
  myUserId: string | null;
  onDelete: (id: string) => void;
  onToggleReaction: (id: string, currentlyReacted: boolean) => void;
  onReply: () => void;
  onReport: () => void;
  colors: Colors;
  styles: Styles;
  t: ReturnType<typeof useLanguage>["t"];
  // Only set for a top-level comment (see the CommentsSection call site) —
  // a reply is never itself repliable, so it never has its own thread to
  // expand/collapse.
  repliesCount?: number;
  repliesExpanded?: boolean;
  onToggleReplies?: () => void;
}) {
  return (
    <View style={styles.commentRow}>
      <View style={styles.commentHeader}>
        <Avatar name={c.author?.username ?? t.comments.unknownUser} imageUri={c.author?.avatar_url} size="sm" />
        <Text style={styles.commentAuthor} numberOfLines={1}>
          {c.author?.username ?? t.comments.unknownUser}
        </Text>
        <Text style={styles.commentDate}>{c.created_at.slice(0, 10)}</Text>
        {c.user_id === myUserId ? (
          <Pressable
            onPress={() =>
              alert(t.comments.deleteTitle, t.comments.deleteBody, [
                { text: t.comments.cancel, style: "cancel" },
                { text: t.comments.delete, style: "destructive", onPress: () => onDelete(c.id) },
              ])
            }
            hitSlop={8}
            style={styles.deleteBtn}
            accessibilityRole="button"
            accessibilityLabel="Delete comment"
          >
            <Ionicons name="trash-outline" size={14} color={colors.textFaint} />
          </Pressable>
        ) : (
          <Pressable
            onPress={onReport}
            hitSlop={8}
            style={styles.deleteBtn}
            accessibilityRole="button"
            accessibilityLabel={t.report.reportComment}
          >
            <Ionicons name="flag-outline" size={14} color={colors.textFaint} />
          </Pressable>
        )}
      </View>
      <Text style={styles.commentBody}>{c.body}</Text>
      <View style={styles.actionsRow}>
        <Pressable
          style={styles.reactionBtn}
          onPress={() => onToggleReaction(c.id, c.reactedByMe)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={c.reactedByMe ? "Unlike" : "Like"}
        >
          <Ionicons
            name={c.reactedByMe ? "heart" : "heart-outline"}
            size={14}
            color={c.reactedByMe ? colors.red : colors.textFaint}
          />
          {c.reactionCount > 0 && (
            <Text style={[styles.reactionCount, c.reactedByMe && { color: colors.red }]}>{c.reactionCount}</Text>
          )}
        </Pressable>
        <Pressable style={styles.replyBtn} onPress={onReply} hitSlop={8} accessibilityRole="button" accessibilityLabel="Reply">
          <Ionicons name="arrow-undo-outline" size={14} color={colors.textFaint} />
          <Text style={styles.replyBtnText}>{t.comments.reply}</Text>
        </Pressable>
      </View>
      {!!repliesCount && (
        <Pressable
          style={styles.viewRepliesBtn}
          onPress={onToggleReplies}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={repliesExpanded ? t.comments.hideReplies : t.comments.viewReplies(repliesCount)}
        >
          <Ionicons name={repliesExpanded ? "chevron-up" : "chevron-down"} size={13} color={colors.accent} />
          <Text style={styles.viewRepliesText}>
            {repliesExpanded ? t.comments.hideReplies : t.comments.viewReplies(repliesCount)}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    replyingToRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: colors.backgroundAlt,
      borderRadius: radius.sm,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginBottom: 8,
    },
    replyingToText: { flex: 1, color: colors.textMuted, fontSize: type.caption, fontWeight: "700" },
    inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, marginBottom: 16 },
    input: {
      flex: 1,
      minHeight: 40,
      maxHeight: 100,
      backgroundColor: colors.backgroundAlt,
      borderRadius: radius.sm,
      paddingHorizontal: 14,
      paddingVertical: 10,
      color: colors.text,
      fontSize: type.input,
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
    errorText: { color: colors.red, fontSize: type.caption, marginTop: -10, marginBottom: 12 },
    commentRow: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: 12,
      marginBottom: 10,
      ...dropShadow({ opacity: 0.08, radius: 8, offsetY: 2, elevation: 2 }),
    },
    // Indents a reply under its parent, with a left rule so the thread
    // reads as a nested conversation instead of just another comment.
    replyWrap: {
      marginLeft: 20,
      paddingLeft: 10,
      borderLeftWidth: 2,
      borderLeftColor: colors.border,
    },
    viewRepliesBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      marginTop: 10,
    },
    viewRepliesText: { fontSize: type.caption, fontWeight: "700", color: colors.accent },
    commentHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
    commentAuthor: { flex: 1, fontWeight: "800", fontSize: type.body, color: colors.text },
    commentDate: { fontSize: type.micro, color: colors.textFaint },
    deleteBtn: { padding: 2 },
    commentBody: { color: colors.text, fontSize: type.bodySm, lineHeight: 19, marginTop: 6 },
    actionsRow: { flexDirection: "row", alignItems: "center", gap: 16, marginTop: 8 },
    reactionBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
    reactionCount: { fontSize: type.caption, fontWeight: "700", color: colors.textFaint },
    replyBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
    replyBtnText: { fontSize: type.caption, fontWeight: "700", color: colors.textFaint },
  });
}
