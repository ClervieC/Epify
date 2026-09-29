import { useMemo } from "react";
import { View, Text, Pressable, Animated, StyleSheet, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, type, Colors } from "../lib/theme";
import { useScalePress, useMountIn } from "../lib/animations";

interface ShowCardProps {
  id: number;
  name: string;
  imageUrl: string | null;
  subtitle?: string;
  // Defaults to navigating to /show/{id} — overridden by callers pointing
  // this card at something else with its own id space (e.g. Profile's
  // favorite-episodes row, where `id` is an episode id, not a show id).
  onPress?: () => void;
  // Fires on the initial touch, before onPress — for a caller that needs to
  // know a navigation is about to happen earlier than onPress itself runs
  // (see app/users/[id]/list.tsx's own scroll-restoration guard, and
  // app/browse.tsx's identical one, for why that timing actually matters).
  // Composed with useScalePress's own onPressIn below, not a replacement.
  onNavigateAway?: () => void;
  // A small "x" overlaid on the poster corner when set — e.g. removing a
  // show from a custom list (see app/list/[id].tsx) without navigating
  // into it first.
  onRemove?: () => void;
  // Same heart/add-to-list icon pair Explore's own cards show (ExploreCard/
  // ExploreMovieCard in app/(tabs)/explore.tsx) — opt-in via onToggleFavorite/
  // onQuickAdd so the many other ShowCard call sites (Profile's own rows,
  // a show's cast/recommendations, ...) stay exactly as they were. Used by
  // the "View all" grids (app/browse.tsx, app/users/[id]/list.tsx), where a
  // plain poster-only card made it hard to favorite/add without opening the
  // detail page first.
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  isAdded?: boolean;
  onQuickAdd?: () => void;
  // Shown instead of the add icon while a caller is still resolving what
  // this card actually is (e.g. browse.tsx's TMDB→TVmaze lookup for a TV
  // show) — same spirit as its own per-card "resolving" overlay, just
  // scoped to the add button instead of the whole card.
  quickAddPending?: boolean;
  // This card's own marginRight is meant for a horizontal-scroll row, where
  // it's the gutter between cards and there's no "last card" whose trailing
  // margin matters. app/users/[id]/list.tsx's centered grid uses a real flex
  // `gap` between columns instead (so a short/partial last row still centers
  // correctly — see its own comment on why), and setting this on top of that
  // double-spaced every column and threw off that centering by half a
  // margin's worth. Opt-in so every other (horizontal-row) call site is
  // unaffected.
  noTrailingMargin?: boolean;
}

export function ShowCard({
  id,
  name,
  imageUrl,
  subtitle,
  onPress,
  onNavigateAway,
  onRemove,
  isFavorite,
  onToggleFavorite,
  isAdded,
  onQuickAdd,
  quickAddPending,
  noTrailingMargin,
}: ShowCardProps) {
  const router = useRouter();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { scale, onPressIn, onPressOut } = useScalePress();
  const mountIn = useMountIn();

  return (
    <Pressable
      onPressIn={() => {
        onPressIn();
        onNavigateAway?.();
      }}
      onPressOut={onPressOut}
      onPress={onPress ?? (() => router.push(`/show/${id}`))}
    >
      <Animated.View
        style={[
          styles.card,
          noTrailingMargin && styles.cardNoMargin,
          { opacity: mountIn.opacity, transform: [...mountIn.transform, { scale }] },
        ]}
      >
        <View>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.image} contentFit="cover" />
          ) : (
            <View style={[styles.image, styles.placeholder]}>
              <Text style={styles.placeholderText}>{name[0]}</Text>
            </View>
          )}
          {onRemove && (
            <Pressable
              style={styles.removeBtn}
              onPress={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Remove"
            >
              <Ionicons name="close" size={13} color="#fff" />
            </Pressable>
          )}
          {(onToggleFavorite || onQuickAdd) && (
            <View style={styles.cardActions}>
              {onToggleFavorite && (
                <Pressable
                  style={styles.iconBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    onToggleFavorite();
                  }}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel="Favorite"
                >
                  <Ionicons name={isFavorite ? "heart" : "heart-outline"} size={15} color={isFavorite ? colors.red : "#fff"} />
                </Pressable>
              )}
              {onQuickAdd && (
                <Pressable
                  style={[styles.iconBtn, isAdded && styles.iconBtnActive]}
                  onPress={(e) => {
                    e.stopPropagation();
                    onQuickAdd();
                  }}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel="Add"
                >
                  {quickAddPending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name={isAdded ? "checkmark" : "add"} size={16} color={isAdded ? colors.onAccent : "#fff"} />
                  )}
                </Pressable>
              )}
            </View>
          )}
        </View>
        <Text style={styles.name} numberOfLines={2}>
          {name}
        </Text>
        {subtitle && (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    card: { width: 110, marginRight: 12 },
    cardNoMargin: { marginRight: 0 },
    image: { width: 110, height: 155, borderRadius: radius.sm, backgroundColor: colors.backgroundAlt },
    placeholder: { alignItems: "center", justifyContent: "center" },
    placeholderText: { color: colors.textFaint, fontSize: type.display, fontWeight: "700" },
    removeBtn: {
      position: "absolute",
      top: 6,
      right: 6,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: "rgba(0,0,0,0.55)",
      alignItems: "center",
      justifyContent: "center",
    },
    // Matches Explore's own cardActions/iconBtn exactly (app/(tabs)/
    // explore.tsx's ExploreCard/ExploreMovieCard) so a card looks the same
    // whether it's showing up in search or in one of these grids.
    cardActions: { position: "absolute", top: 8, right: 8, gap: 6 },
    iconBtn: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: "rgba(0,0,0,0.45)",
      alignItems: "center",
      justifyContent: "center",
    },
    iconBtnActive: { backgroundColor: colors.accent },
    name: { color: colors.text, fontSize: 13, fontWeight: "600", marginTop: 6 },
    subtitle: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  });
}
