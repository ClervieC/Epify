import { useMemo } from "react";
import { View, Text, Image, Pressable, ScrollView, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { CastMember } from "../lib/tvmaze";
import { CharacterVoteTally } from "../lib/characterVotes";

const MAX_CANDIDATES = 20;

interface CharacterVoteProps {
  cast: CastMember[];
  tally: CharacterVoteTally[];
  myCharacterId: number | null;
  onVote: (member: CastMember) => void;
  onRemoveVote: () => void;
}

export function CharacterVote({ cast, tally, myCharacterId, onVote, onRemoveVote }: CharacterVoteProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useLanguage();

  const countByCharacter = useMemo(() => new Map(tally.map((v) => [v.characterId, v.count])), [tally]);
  const candidates = cast.filter((c) => !!c.person).slice(0, MAX_CANDIDATES);

  if (candidates.length === 0) return null;

  return (
    <View>
      <Text style={styles.title}>{t.characterVote.title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {candidates.map((c) => {
          const selected = myCharacterId === c.character.id;
          const count = countByCharacter.get(c.character.id) ?? 0;
          return (
            <Pressable
              key={c.character.id}
              style={styles.card}
              onPress={() => (selected ? onRemoveVote() : onVote(c))}
            >
              <View style={[styles.avatarWrap, selected && styles.avatarWrapSelected]}>
                {c.person.image ? (
                  <Image source={{ uri: c.person.image.medium }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Ionicons name="person" size={20} color={colors.textFaint} />
                  </View>
                )}
                {selected && (
                  <View style={styles.selectedBadge}>
                    <Ionicons name="checkmark" size={11} color="#fff" />
                  </View>
                )}
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {c.character.name}
              </Text>
              {count > 0 && (
                <Text style={styles.voteCount}>{t.characterVote.voteCount(count)}</Text>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    title: { fontSize: 18, fontWeight: "800", color: colors.text, marginBottom: 12 },
    card: { width: 80, marginRight: 14, alignItems: "center" },
    avatarWrap: { position: "relative" },
    avatarWrapSelected: { opacity: 1 },
    avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.backgroundAlt },
    avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
    selectedBadge: {
      position: "absolute",
      bottom: -2,
      right: -2,
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: colors.green,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: colors.background,
    },
    name: { fontSize: 11, fontWeight: "700", color: colors.text, marginTop: 6, textAlign: "center" },
    voteCount: { fontSize: 10, color: colors.textMuted, marginTop: 1 },
  });
}
