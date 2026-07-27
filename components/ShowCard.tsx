import { useMemo } from "react";
import { View, Text, Pressable, Animated, StyleSheet } from "react-native";
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
  // A small "x" overlaid on the poster corner when set — e.g. removing a
  // show from a custom list (see app/list/[id].tsx) without navigating
  // into it first.
  onRemove?: () => void;
}

export function ShowCard({ id, name, imageUrl, subtitle, onPress, onRemove }: ShowCardProps) {
  const router = useRouter();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { scale, onPressIn, onPressOut } = useScalePress();
  const mountIn = useMountIn();

  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={onPress ?? (() => router.push(`/show/${id}`))}
    >
      <Animated.View
        style={[styles.card, { opacity: mountIn.opacity, transform: [...mountIn.transform, { scale }] }]}
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
    name: { color: colors.text, fontSize: 13, fontWeight: "600", marginTop: 6 },
    subtitle: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  });
}
