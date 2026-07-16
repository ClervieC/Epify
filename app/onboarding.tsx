import { useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  Animated,
  StyleSheet,
  NativeSyntheticEvent,
  NativeScrollEvent,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors, radius, type, dropShadow, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { markOnboardingComplete } from "../lib/onboarding";
import { StaleWatchlistMonths } from "../lib/userSettings";
import { useMountIn } from "../lib/animations";
import { useAuth } from "../context/AuthContext";

interface Slide {
  image: number;
  title: string;
  body: string;
}

// Shown once per device on first login/signup (see the redirect check in
// app/_layout.tsx and lib/onboarding.ts) — a lot of the app's value (Watch
// Next, streaks, activity feed) only becomes visible once you've actually
// followed a few shows, so a brand new account landing straight on an empty
// Shows tab had nothing to explain what to do next. Screenshots (assets/
// onboarding/*.png) instead of a built-from-shapes mockup — real app UI reads
// as more trustworthy than an illustration of it.
export default function OnboardingScreen() {
  const router = useRouter();
  const colors = useColors();
  const { width, height } = useWindowDimensions();
  // Below this height the vertical stack (320px screenshot + title + body)
  // no longer fits inside slidesList's flex:1 share of the screen — see the
  // "overflow: hidden" note on the slidesList style below for what used to
  // happen instead of just clipping (the footer, including Next/Get
  // started, got pushed off-screen entirely). A side-by-side layout needs
  // far less vertical room than a stacked one, so short/landscape-ish
  // viewports (a short browser window, a phone rotated sideways) get that
  // instead of a clipped stack.
  const isShort = height < 700;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t, setStaleWatchlistMonths } = useLanguage();
  const { setNeedsOnboarding } = useAuth();
  const [index, setIndex] = useState(0);
  // The threshold question is asked once, right before finishing — after the
  // last slide's "Get started" or after "Skip" either way, since it's a
  // single tap and not worth gating behind sitting through the full
  // slideshow. See chooseReminder below for where the answer is persisted.
  const [step, setStep] = useState<"slides" | "reminder">("slides");
  const listRef = useRef<FlatList<Slide>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const slides: Slide[] = [
    {
      image: require("../assets/onboarding/mylist.png"),
      title: t.onboarding.slide1Title,
      body: t.onboarding.slide1Body,
    },
    {
      image: require("../assets/onboarding/upcoming.png"),
      title: t.onboarding.slide2Title,
      body: t.onboarding.slide2Body,
    },
    {
      image: require("../assets/onboarding/details.png"),
      title: t.onboarding.slide4Title,
      body: t.onboarding.slide4Body,
    },
    {
      image: require("../assets/onboarding/explore.png"),
      title: t.onboarding.slide3Title,
      body: t.onboarding.slide3Body,
    },
    {
      image: require("../assets/onboarding/movies.png"),
      title: t.onboarding.slide5Title,
      body: t.onboarding.slide5Body,
    },
    {
      image: require("../assets/onboarding/activity.png"),
      title: t.onboarding.slide6Title,
      body: t.onboarding.slide6Body,
    },
    {
      image: require("../assets/onboarding/profile.png"),
      title: t.onboarding.slide7Title,
      body: t.onboarding.slide7Body,
    },
  ];
  const isLast = index === slides.length - 1;

  function askReminder() {
    setStep("reminder");
  }

  async function chooseReminder(months: StaleWatchlistMonths) {
    setStaleWatchlistMonths(months);
    await markOnboardingComplete();
    // Tells app/_layout.tsx's redirect effect directly — markOnboardingComplete()
    // only persists to AsyncStorage, which nothing re-reads on navigation, so
    // without this the redirect effect (it re-runs on every segment change,
    // including the router.replace below) kept seeing the stale `true` from
    // sign-up and bouncing straight back to /onboarding in a loop.
    setNeedsOnboarding(false);
    router.replace("/(tabs)/explore");
  }

  function next() {
    if (isLast) {
      askReminder();
      return;
    }
    listRef.current?.scrollToOffset({
      offset: (index + 1) * width,
      animated: true,
    });
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  }

  if (step === "reminder") {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={[`${colors.accent}26`, "transparent"]}
          style={[styles.glow, { pointerEvents: "none" }]}
        />
        <View style={styles.reminderStep}>
          <Ionicons name="alarm-outline" size={40} color={colors.accent} style={{ marginBottom: 20 }} />
          <Text style={styles.title}>{t.onboarding.reminderTitle}</Text>
          <Text style={styles.body}>{t.onboarding.reminderBody}</Text>
          <View style={styles.reminderOptions}>
            <Pressable
              style={[styles.reminderOptionBtn, { backgroundColor: colors.accent }]}
              onPress={() => chooseReminder(6)}
              accessibilityRole="button"
            >
              <Text style={styles.nextBtnText}>{t.onboarding.reminderSixMonths}</Text>
            </Pressable>
            <Pressable
              style={[styles.reminderOptionBtn, { backgroundColor: colors.pillBg }]}
              onPress={() => chooseReminder(12)}
              accessibilityRole="button"
            >
              <Text style={[styles.nextBtnText, { color: colors.text }]}>{t.onboarding.reminderOneYear}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[`${colors.accent}26`, "transparent"]}
        style={[styles.glow, { pointerEvents: "none" }]}
      />

      <View style={styles.topBar}>
        <View style={styles.progressTrack}>
          {slides.map((_s, i) => (
            <View
              key={i}
              style={[
                styles.progressSegment,
                i <= index && { backgroundColor: colors.accent },
              ]}
            />
          ))}
        </View>
        {!isLast && (
          <Pressable onPress={askReminder} accessibilityRole="button" hitSlop={10}>
            <Text style={styles.skipText}>{t.onboarding.skip}</Text>
          </Pressable>
        )}
      </View>

      <Animated.FlatList
        ref={listRef}
        style={styles.slidesList}
        data={slides}
        keyExtractor={(_s, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        // Only 7 lightweight slides total — rendering them all upfront
        // (rather than a narrow virtualization window) avoids a page
        // occasionally still being unmeasured/unmounted by the time
        // scrollToOffset's *computed* target lands on it, which showed up
        // as a slide rendering blank/misaligned until manually nudged.
        // getItemLayout removes any remaining dependency on measurement —
        // every page is exactly `width` wide, so its offset is knowable
        // upfront instead of discovered after layout.
        initialNumToRender={slides.length}
        getItemLayout={(_data, i) => ({ length: width, offset: width * i, index: i })}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          {
            useNativeDriver: false,
            listener: onScroll,
          },
        )}
        scrollEventThrottle={16}
        renderItem={({ item }) => (
          <OnboardingSlide
            slide={item}
            width={width}
            isShort={isShort}
            colors={colors}
            styles={styles}
          />
        )}
      />

      <View style={styles.footer}>
        <Pressable
          style={[styles.nextBtn, { backgroundColor: colors.accent }]}
          onPress={next}
          accessibilityRole="button"
        >
          <Text style={styles.nextBtnText}>
            {isLast ? t.onboarding.getStarted : t.onboarding.next}
          </Text>
          <Ionicons
            name={isLast ? "checkmark" : "arrow-forward"}
            size={18}
            color={colors.onAccent}
          />
        </Pressable>
      </View>
    </View>
  );
}

function OnboardingSlide({
  slide,
  width,
  isShort,
  colors,
  styles,
}: {
  slide: Slide;
  width: number;
  isShort: boolean;
  colors: Colors;
  styles: OnboardingStyles;
}) {
  const mountIn = useMountIn();

  const screenshot = (
    <Animated.View
      style={[
        isShort ? styles.screenshotWrapShort : styles.screenshotWrap,
        { opacity: mountIn.opacity, transform: mountIn.transform },
      ]}
    >
      <Image
        source={slide.image}
        style={styles.screenshot}
        contentFit="cover"
        // Anchored top-left rather than centered — one of these
        // screenshots (mylist.png) has extra blank canvas on its right
        // edge, wider than the other three, so a centered crop clipped
        // into the actual UI on one side while leaving blank space
        // showing on the other. Anchoring top-left keeps the real
        // content (which starts at 0,0 in every one of these) fully
        // in frame regardless of that inconsistency.
        contentPosition="top left"
      />
    </Animated.View>
  );

  const text = (
    <>
      <Animated.Text
        style={[
          isShort ? styles.titleShort : styles.title,
          { opacity: mountIn.opacity, transform: mountIn.transform },
        ]}
      >
        {slide.title}
      </Animated.Text>
      <Animated.Text
        style={[
          isShort ? styles.bodyShort : styles.body,
          { opacity: mountIn.opacity, transform: mountIn.transform },
        ]}
      >
        {slide.body}
      </Animated.Text>
    </>
  );

  // Short/landscape-ish viewports (a short browser window, a phone turned
  // sideways) don't have the vertical room for the screenshot stacked above
  // the title/body — see the isShort computation in OnboardingScreen. Image
  // on the left, text on the right, both vertically centered together,
  // needs only the taller of the two instead of the sum of both.
  if (isShort) {
    return (
      <View style={[styles.slideShort, { width }]}>
        {screenshot}
        <View style={styles.slideShortText}>{text}</View>
      </View>
    );
  }

  return (
    <View style={[styles.slide, { width }]}>
      {screenshot}
      {text}
    </View>
  );
}

type OnboardingStyles = ReturnType<typeof createStyles>;

function createStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    glow: { position: "absolute", top: 0, left: 0, right: 0, height: 420 },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      paddingHorizontal: 24,
      paddingTop: 40,
      paddingBottom: 15,
    },
    // overflow: hidden matters more than it looks like it should: on web,
    // flex:1 alone lets a child grow past its allotted share to fit its
    // *content's* minimum size (CSS flexbox's default min-height:auto) —
    // React Native's own layout engine (used natively) doesn't have that
    // quirk, so this only ever showed up on web. Without this, a slide
    // taller than the space left over from topBar+footer pushed the footer
    // (and with it, the only way to advance past the last slide) below the
    // viewport instead of just clipping the overflowing slide content.
    slidesList: { flex: 1, overflow: "hidden" },
    progressTrack: { flex: 1, flexDirection: "row", gap: 6 },
    progressSegment: {
      flex: 1,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.pillBg,
    },
    skipText: {
      color: colors.textMuted,
      fontWeight: "700",
      fontSize: type.bodySm,
    },
    slide: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 28,
    },
    screenshotWrap: {
      // Matches the real screenshots' own ~373:667 ratio (see the crop note
      // on the Image below) rather than an arbitrary box.
      width: 179,
      height: 320,
      borderRadius: radius.lg,
      overflow: "hidden",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 28,
      ...dropShadow({ opacity: 0.18, radius: 20, offsetY: 10, elevation: 8 }),
    },
    screenshot: { width: "100%", height: "100%" },
    title: {
      fontSize: type.display,
      fontWeight: "800",
      color: colors.text,
      textAlign: "center",
      marginBottom: 12,
    },
    body: {
      fontSize: type.body,
      color: colors.textMuted,
      textAlign: "center",
      lineHeight: 22,
      maxWidth: 300,
    },
    slideShort: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 24,
      paddingHorizontal: 28,
    },
    slideShortText: { flex: 1, maxWidth: 340 },
    screenshotWrapShort: {
      width: 120,
      height: 214,
      borderRadius: radius.lg,
      overflow: "hidden",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      ...dropShadow({ opacity: 0.18, radius: 20, offsetY: 10, elevation: 8 }),
    },
    titleShort: {
      fontSize: type.title,
      fontWeight: "800",
      color: colors.text,
      textAlign: "left",
      marginBottom: 8,
    },
    bodyShort: {
      fontSize: type.bodySm,
      color: colors.textMuted,
      textAlign: "left",
      lineHeight: 20,
    },
    footer: { paddingHorizontal: 24, paddingBottom: 44, paddingTop: 8 },
    nextBtn: {
      flexDirection: "row",
      width: "100%",
      borderRadius: radius.pill,
      paddingVertical: 17,
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    nextBtnText: {
      color: colors.onAccent,
      fontWeight: "800",
      fontSize: type.body,
    },
    reminderStep: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 28,
      paddingBottom: 44,
    },
    reminderOptions: { width: "100%", gap: 12, marginTop: 32 },
    reminderOptionBtn: {
      width: "100%",
      borderRadius: radius.pill,
      paddingVertical: 17,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
