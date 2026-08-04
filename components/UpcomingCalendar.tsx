import { ReactNode, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Animated,
  useWindowDimensions,
  StyleProp,
  ViewStyle,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useColors, radius, spacing, type, dropShadow, Colors } from "../lib/theme";
import { useLanguage } from "../lib/i18n";
import { useScalePress, useSheetTransition } from "../lib/animations";
import { dateKeyFromDate } from "../lib/dates";

export interface CalendarItem {
  id: string;
  // Local YYYY-MM-DD. Treated as an opaque lookup key throughout this
  // component — never re-parsed through `new Date()` — since episodes
  // (derived from a UTC instant) and movies (a date-only TMDB string with no
  // timezone at all) each compute this safely in their own way, and
  // re-deriving it here would risk disagreeing with whichever one produced
  // it. All Date math in this file is confined to the calendar's own
  // grid/week generation.
  dateKey: string;
  title: string;
  subtitle?: string;
  imageUrl: string | null;
  // Short label (e.g. "S1E4") shown next to the month-grid bubble so a day
  // cell reads as "this show, this episode" at a glance instead of a bare
  // release count. Left blank for movies — the poster alone is enough.
  badge?: string;
  // Groups same-day items together in the month grid (e.g. a show's id, so
  // two episodes of the same show airing the same day collapse into one
  // bubble + "+1" instead of two separate rows). Defaults to `id`, i.e. no
  // grouping, when omitted — movies never need it.
  groupKey?: string;
  // Rings the month-grid bubble green (seen) or muted (not yet) when set —
  // left undefined draws no ring at all, so callers that don't track a
  // watched state (e.g. shows, which have their own richer per-episode
  // status elsewhere) aren't affected.
  watched?: boolean;
  onPress?: () => void;
}

export type Granularity = "month" | "week";

interface UpcomingCalendarProps {
  items: CalendarItem[];
  emptyLabel: string;
  // Controlled rather than owned internally: the Month/Week toggle itself
  // (see CalendarGranularityToggle below) is rendered by the screen, on the
  // same row as its own list/calendar toggle, to save a full row of vertical
  // space for the grid — so the screen needs to hold this state itself
  // rather than this component owning it in isolation.
  granularity: Granularity;
  onChangeGranularity: (next: Granularity) => void;
  // Let the screen stretch this to fill its available height (e.g. a
  // ScrollView's contentContainerStyle with flexGrow: 1) — the month grid
  // below grows to fill it via flex, so the calendar reads as "as big as
  // the screen" instead of a small fixed-size block.
  style?: StyleProp<ViewStyle>;
}

const WEEKDAY_REFERENCE = new Date(2024, 0, 7); // a Sunday, for building weekday-initial headers

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfWeek(d: Date) {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

interface DayGroup {
  key: string;
  imageUrl: string | null;
  label: string;
  count: number;
  // Taken from the first item in the group — same as imageUrl/label, only
  // meaningful for callers (movies) where every item in a group shares one
  // watched state to begin with; shows never set `groupKey` so each group
  // is always exactly one item anyway.
  watched?: boolean;
}

// Collapses same-show items (matched by `groupKey`, falling back to `id` —
// i.e. no collapsing — when a caller doesn't set one) into one row per show,
// so a day with several episodes of the same show shows one bubble + a
// "+N" count instead of a separate row per episode.
function groupDayItems(items: CalendarItem[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const index = new Map<string, DayGroup>();
  for (const item of items) {
    const key = item.groupKey ?? item.id;
    const existing = index.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      const group: DayGroup = {
        key,
        imageUrl: item.imageUrl,
        label: item.badge ?? item.title,
        count: 1,
        watched: item.watched,
      };
      index.set(key, group);
      groups.push(group);
    }
  }
  return groups;
}

const WIDE_BREAKPOINT = 700;

export function UpcomingCalendar({
  items,
  emptyLabel,
  granularity,
  onChangeGranularity,
  style,
}: UpcomingCalendarProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t, language } = useLanguage();
  const { width: windowWidth } = useWindowDimensions();
  // Desktop/tablet gets richer layouts (more shows per day cell, week
  // columns side by side) — phone gets the same compact ones either way,
  // since there's rarely room to spare once the screen narrows this far.
  const isWide = windowWidth >= WIDE_BREAKPOINT;

  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [openDayKey, setOpenDayKey] = useState<string | null>(null);
  // Where the popover should anchor, in coordinates local to `rootRef`
  // (below). Deliberately *not* the press event's pageX/pageY — on web
  // those are relative to the whole scrolled document, while the popover
  // itself is positioned relative to this component's own box, so the two
  // don't agree once the page has scrolled at all. measureLayout (see
  // openDay) instead measures the pressed cell directly against rootRef,
  // which is scroll-offset-immune since both live in the same subtree.
  // Both edges are kept (not just one) because the popover anchors to a
  // *different* edge depending on which way it opens — see DayPopover.
  const [popoverAnchor, setPopoverAnchor] = useState<{ x: number; top: number; bottom: number } | null>(null);
  const rootRef = useRef<View>(null);
  const [rootSize, setRootSize] = useState({ width: 0, height: 0 });
  const cellRefs = useRef(new Map<string, View | null>()).current;

  function openDay(dateKey: string) {
    const node = cellRefs.get(dateKey);
    const root = rootRef.current;
    if (!node || !root) {
      setOpenDayKey(dateKey);
      return;
    }
    node.measureLayout(
      root,
      (left, top, width, height) => {
        setPopoverAnchor({ x: left + width / 2, top, bottom: top + height });
        setOpenDayKey(dateKey);
      },
      () => setOpenDayKey(dateKey)
    );
  }

  function closeDay() {
    setOpenDayKey(null);
  }

  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const existing = map.get(item.dateKey);
      if (existing) existing.push(item);
      else map.set(item.dateKey, [item]);
    }
    return map;
  }, [items]);

  const todayKey = dateKeyFromDate(new Date());
  const weekdayLabels = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(WEEKDAY_REFERENCE);
        d.setDate(d.getDate() + i);
        return d.toLocaleDateString(language, { weekday: "short" });
      }),
    [language]
  );

  const monthCells = useMemo(() => {
    if (granularity !== "month") return [];
    const monthStart = startOfMonth(anchorDate);
    const gridStart = startOfWeek(monthStart);
    return Array.from({ length: 42 }, (_, i) => {
      const date = new Date(gridStart);
      date.setDate(date.getDate() + i);
      const dateKey = dateKeyFromDate(date);
      return {
        date,
        dateKey,
        dayNumber: date.getDate(),
        inCurrentMonth: isSameMonth(date, monthStart),
        isToday: dateKey === todayKey,
        items: itemsByDate.get(dateKey) ?? [],
      };
    });
  }, [granularity, anchorDate, itemsByDate, todayKey]);

  // Chunked into rows of 7 so each week can be its own flex row — that's
  // what lets the grid grow to fill whatever height the screen gives it
  // (see `style` above) instead of cells being square and capped by width.
  const monthRows = useMemo(() => {
    const rows: (typeof monthCells)[] = [];
    for (let i = 0; i < monthCells.length; i += 7) rows.push(monthCells.slice(i, i + 7));
    return rows;
  }, [monthCells]);

  const weekCells = useMemo(() => {
    if (granularity !== "week") return [];
    const weekStart = startOfWeek(anchorDate);
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + i);
      const dateKey = dateKeyFromDate(date);
      return {
        date,
        dateKey,
        isToday: dateKey === todayKey,
        items: itemsByDate.get(dateKey) ?? [],
      };
    });
  }, [granularity, anchorDate, itemsByDate, todayKey]);

  // All three navigation actions close any open day popover first — it's
  // anchored (position and content) to a specific cell in the *current*
  // grid, which is about to stop being rendered, so leaving it open would
  // strand it detached from anything visible once the new month/week paints.
  function goPrev() {
    closeDay();
    setAnchorDate((prev) => {
      const next = new Date(prev);
      if (granularity === "month") next.setMonth(next.getMonth() - 1);
      else next.setDate(next.getDate() - 7);
      return next;
    });
  }

  function goNext() {
    closeDay();
    setAnchorDate((prev) => {
      const next = new Date(prev);
      if (granularity === "month") next.setMonth(next.getMonth() + 1);
      else next.setDate(next.getDate() + 7);
      return next;
    });
  }

  function goToToday() {
    closeDay();
    setAnchorDate(new Date());
  }

  // Hides the Today button once it'd be a no-op — no point offering to jump
  // to where you already are.
  const today = new Date();
  const isCurrentPeriod =
    granularity === "month"
      ? isSameMonth(anchorDate, today)
      : startOfWeek(anchorDate).getTime() === startOfWeek(today).getTime();

  const headerLabel =
    granularity === "month"
      ? anchorDate.toLocaleDateString(language, { month: "long", year: "numeric" })
      : (() => {
          const start = startOfWeek(anchorDate);
          const end = new Date(start);
          end.setDate(end.getDate() + 6);
          const sameMonth = start.getMonth() === end.getMonth();
          const startLabel = start.toLocaleDateString(language, { month: "short", day: "numeric" });
          const endLabel = end.toLocaleDateString(language, {
            month: sameMonth ? undefined : "short",
            day: "numeric",
          });
          return `${startLabel} – ${endLabel}`;
        })();

  const openDayItems = openDayKey ? itemsByDate.get(openDayKey) ?? [] : [];

  return (
    <View
      style={style}
      ref={rootRef}
      onLayout={(e) => setRootSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      <View style={styles.navRow}>
        <Pressable onPress={goPrev} hitSlop={8} accessibilityLabel="Previous" accessibilityRole="button">
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.navLabel}>{headerLabel}</Text>
        <View style={styles.navRightGroup}>
          {!isCurrentPeriod && (
            <Pressable
              onPress={goToToday}
              style={styles.todayBtn}
              hitSlop={8}
              accessibilityLabel={t.calendar.today}
              accessibilityRole="button"
            >
              <Text style={styles.todayBtnText}>{t.calendar.today}</Text>
            </Pressable>
          )}
          <Pressable onPress={goNext} hitSlop={8} accessibilityLabel="Next" accessibilityRole="button">
            <Ionicons name="chevron-forward" size={20} color={colors.text} />
          </Pressable>
        </View>
      </View>

      {granularity === "month" ? (
        <View style={styles.monthGrid}>
          <View style={styles.weekdayRow}>
            {weekdayLabels.map((label, i) => (
              <Text key={i} style={styles.weekdayLabel}>
                {label}
              </Text>
            ))}
          </View>
          <View style={styles.gridBody}>
            {monthRows.map((row, ri) => (
              <View key={ri} style={styles.gridRow}>
                {row.map((cell) => {
                  const groups = groupDayItems(cell.items);
                  const hasItems = groups.length > 0;
                  return (
                    <Pressable
                      key={cell.dateKey}
                      ref={(node) => {
                        cellRefs.set(cell.dateKey, node);
                      }}
                      style={styles.dayCell}
                      disabled={!hasItems}
                      onPress={() => openDay(cell.dateKey)}
                      accessibilityLabel={hasItems ? t.calendar.releasesCount(cell.items.length) : undefined}
                    >
                      <View style={[styles.dayCellInner, cell.isToday && styles.dayCellInnerToday]}>
                        <View
                          style={[styles.dayNumberPill, cell.isToday && styles.dayNumberPillToday]}
                        >
                          <Text
                            style={[
                              styles.dayNumberText,
                              !cell.inCurrentMonth && styles.dayNumberTextFaded,
                              cell.isToday && styles.dayNumberTextToday,
                            ]}
                          >
                            {cell.dayNumber}
                          </Text>
                        </View>
                        <MonthDayGroups groups={groups} isWide={isWide} colors={colors} styles={styles} />
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      ) : isWide ? (
        <View style={styles.weekRowWide}>
          {weekCells.map((day) => (
            <View key={day.dateKey} style={styles.weekColumnWide}>
              <View style={styles.weekColumnHeader}>
                <Text style={[styles.weekColumnDayLabel, day.isToday && styles.weekDayLabelToday]}>
                  {day.date.toLocaleDateString(language, { weekday: "short" })}
                </Text>
                <Text style={[styles.weekColumnDateLabel, day.isToday && styles.weekDayLabelToday]}>
                  {day.date.toLocaleDateString(language, { day: "numeric" })}
                </Text>
              </View>
              {day.items.length === 0 ? (
                <Text style={styles.weekEmptyTextWide}>{emptyLabel}</Text>
              ) : (
                day.items.map((item) => (
                  <CalendarItemRow
                    key={item.id}
                    item={item}
                    colors={colors}
                    styles={styles}
                    compact
                    primaryText={item.badge ?? item.title}
                  />
                ))
              )}
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.weekAgenda}>
          {weekCells.map((day) => (
            <View key={day.dateKey} style={styles.weekDaySection}>
              <View style={styles.weekDayHeader}>
                <Text style={[styles.weekDayLabel, day.isToday && styles.weekDayLabelToday]}>
                  {day.date.toLocaleDateString(language, { weekday: "long" })}
                </Text>
                <Text style={styles.weekDayDate}>
                  {day.date.toLocaleDateString(language, { month: "short", day: "numeric" })}
                </Text>
              </View>
              {day.items.length === 0 ? (
                <Text style={styles.weekEmptyText}>{emptyLabel}</Text>
              ) : (
                day.items.map((item) => (
                  <CalendarItemRow
                    key={item.id}
                    item={item}
                    colors={colors}
                    styles={styles}
                    primaryText={item.badge ?? item.title}
                  />
                ))
              )}
            </View>
          ))}
        </View>
      )}

      <DayPopover
        visible={!!openDayKey}
        anchor={popoverAnchor}
        containerWidth={rootSize.width}
        containerHeight={rootSize.height}
        onClose={closeDay}
        colors={colors}
        styles={styles}
      >
        {openDayItems.length === 0 ? (
          <Text style={styles.weekEmptyText}>{emptyLabel}</Text>
        ) : (
          openDayItems.map((item) => (
            <CalendarItemRow
              key={item.id}
              item={item}
              colors={colors}
              styles={styles}
              primaryText={item.badge ?? item.title}
              onPress={() => {
                closeDay();
                item.onPress?.();
              }}
            />
          ))
        )}
      </DayPopover>
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

// A day cell only ever has room for one full show-tile on a phone-narrow
// column without a second one clipping/bleeding into the row below — so
// narrow gets one bubble + "+N" badges for anything past it (same-show
// rewatch count and/or other shows that day). A wide (desktop/tablet)
// column has the room to actually show several shows at a glance, so it
// keeps the fuller multi-tile layout instead of collapsing down to one.
const MAX_VISIBLE_DAY_GROUPS_WIDE = 3;

function MonthDayGroups({
  groups,
  isWide,
  colors,
  styles,
}: {
  groups: DayGroup[];
  isWide: boolean;
  colors: Colors;
  styles: Styles;
}) {
  if (groups.length === 0) return null;

  function bubble(group: DayGroup) {
    const ring =
      group.watched === true
        ? styles.dayGroupBubbleWatched
        : group.watched === false
          ? styles.dayGroupBubbleUnwatched
          : undefined;
    return group.imageUrl ? (
      <Image source={{ uri: group.imageUrl }} style={[styles.dayGroupBubble, ring]} contentFit="cover" />
    ) : (
      <View style={[styles.dayGroupBubble, ring, { backgroundColor: colors.backgroundAlt }]} />
    );
  }

  if (!isWide) {
    const primaryGroup = groups[0];
    const hiddenGroups = groups.length - 1;
    return (
      <View style={styles.dayGroupList}>
        <View style={styles.dayGroupTile}>
          <View style={styles.dayGroupBubbleWrap}>
            {bubble(primaryGroup)}
            {/* Same show airing twice that day (e.g. a rewatch drop) — bottom-right. */}
            {primaryGroup.count > 1 && (
              <View style={[styles.dayGroupBadge, styles.dayGroupBadgeBottom]}>
                <Text style={styles.dayGroupBadgeText}>+{primaryGroup.count - 1}</Text>
              </View>
            )}
            {/* Other shows the same day — top-right, so it can't collide with the one above. */}
            {hiddenGroups > 0 && (
              <View style={[styles.dayGroupBadge, styles.dayGroupBadgeTop]}>
                <Text style={styles.dayGroupBadgeText}>+{hiddenGroups}</Text>
              </View>
            )}
          </View>
          <Text style={styles.dayGroupLabel} numberOfLines={1}>
            {primaryGroup.label}
          </Text>
        </View>
      </View>
    );
  }

  const overflow = groups.length > MAX_VISIBLE_DAY_GROUPS_WIDE;
  const visibleGroups = overflow ? groups.slice(0, MAX_VISIBLE_DAY_GROUPS_WIDE - 1) : groups;
  const hiddenGroups = groups.length - visibleGroups.length;
  return (
    <View style={styles.dayGroupList}>
      {visibleGroups.map((group) => (
        <View key={group.key} style={styles.dayGroupTile}>
          <View style={styles.dayGroupBubbleWrap}>
            {bubble(group)}
            {group.count > 1 && (
              <View style={[styles.dayGroupBadge, styles.dayGroupBadgeBottom]}>
                <Text style={styles.dayGroupBadgeText}>+{group.count - 1}</Text>
              </View>
            )}
          </View>
          <Text style={styles.dayGroupLabel} numberOfLines={1}>
            {group.label}
          </Text>
        </View>
      ))}
      {hiddenGroups > 0 && (
        <View style={styles.dayGroupTile}>
          <View style={[styles.dayGroupBubbleWrap, styles.dayGroupMoreBubble]}>
            <Text style={styles.dayGroupMoreText}>+{hiddenGroups}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

// The Month/Week pill switcher, split out so the screen can place it on the
// same row as its own list/calendar toggle instead of stacking it in its own
// row above the grid — the merge that reclaims that row's height for the
// grid itself. Purely presentational; the screen owns the `granularity`
// state (see UpcomingCalendarProps) and persists it however it persists its
// own list/calendar choice.
export function CalendarGranularityToggle({
  granularity,
  onChange,
  monthLabel,
  weekLabel,
  style,
}: {
  granularity: Granularity;
  onChange: (next: Granularity) => void;
  monthLabel: string;
  weekLabel: string;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={[styles.toggleRow, styles.toggleRowInline, style]}>
      <Pressable
        style={[styles.toggleBtn, granularity === "month" && styles.toggleBtnActive]}
        onPress={() => onChange("month")}
      >
        <Text style={[styles.toggleText, granularity === "month" && styles.toggleTextActive]}>{monthLabel}</Text>
      </Pressable>
      <Pressable
        style={[styles.toggleBtn, granularity === "week" && styles.toggleBtnActive]}
        onPress={() => onChange("week")}
      >
        <Text style={[styles.toggleText, granularity === "week" && styles.toggleTextActive]}>{weekLabel}</Text>
      </Pressable>
    </View>
  );
}

const POPOVER_MARGIN = 12;
const POPOVER_WIDTH = 280;

// A details card anchored to wherever the day cell actually is (`anchor`,
// measured via measureLayout against the calendar's own root — see openDay
// — in coordinates local to that root), rather than the app's shared
// bottom-sheet chrome (see Sheet.tsx) — the calendar wants the popup to read
// as "more info about *that* date" rather than a generic modal. `container*`
// are the root's own measured size (also local, not the window) so
// flip/clamp math stays in the same coordinate space as the anchor. Flips
// above/below and clamps horizontally so it never runs off the calendar's
// own box near an edge.
function DayPopover({
  visible,
  anchor,
  containerWidth,
  containerHeight,
  onClose,
  colors,
  styles,
  children,
}: {
  visible: boolean;
  anchor: { x: number; top: number; bottom: number } | null;
  containerWidth: number;
  containerHeight: number;
  onClose: () => void;
  colors: Colors;
  styles: Styles;
  children: ReactNode;
}) {
  const { mounted, progress } = useSheetTransition(visible && !!anchor && containerWidth > 0);

  if (!mounted || !anchor || containerWidth <= 0) return null;

  const cardWidth = Math.min(POPOVER_WIDTH, containerWidth - POPOVER_MARGIN * 2);
  const left = Math.min(
    Math.max(anchor.x - cardWidth / 2, POPOVER_MARGIN),
    containerWidth - cardWidth - POPOVER_MARGIN
  );
  // Opening below anchors to the cell's bottom edge (the popover starts
  // right after the cell); opening above must anchor to the cell's *top*
  // edge instead (the popover ends right before the cell) — reusing the
  // bottom edge for both, as an earlier version did, put the "opens above"
  // case flush against the row below instead of above the tapped row.
  const opensBelow = anchor.top < containerHeight / 2;
  const arrowLeft = Math.min(Math.max(anchor.x - left, POPOVER_MARGIN), cardWidth - POPOVER_MARGIN);

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [opensBelow ? -8 : 8, 0],
  });

  return (
    <Pressable style={styles.popoverBackdrop} onPress={onClose}>
      <Animated.View
        style={[
          styles.popoverCard,
          {
            width: cardWidth,
            left,
            opacity: progress,
            transform: [{ scale }, { translateY }],
          },
          opensBelow ? { top: anchor.bottom + 12 } : { bottom: containerHeight - anchor.top + 12 },
        ]}
      >
        <View
          style={[
            styles.popoverArrow,
            opensBelow ? styles.popoverArrowUp : styles.popoverArrowDown,
            { left: arrowLeft - 6 },
          ]}
        />
        <Pressable onPress={(e) => e.stopPropagation()}>
          <ScrollView style={styles.sheetScroll}>{children}</ScrollView>
        </Pressable>
      </Animated.View>
    </Pressable>
  );
}

function CalendarItemRow({
  item,
  colors,
  styles,
  onPress,
  compact,
  primaryText,
}: {
  item: CalendarItem;
  colors: Colors;
  styles: Styles;
  onPress?: () => void;
  // The wide week view's columns are only ever a ~1/7th share of the
  // screen — the popover and narrow week agenda have a whole screen width
  // to work with, but a column that narrow left almost nothing for the
  // title/subtitle next to a full-size thumb. A smaller thumb and tighter
  // padding here free up real room for the text instead (the title itself
  // wraps rather than truncating — see itemTitle below — so the full
  // movie/show name is always readable regardless of column width).
  compact?: boolean;
  // Overrides item.title on the bold line. Both week layouts and the day
  // popover pass item.badge ?? item.title — for a show that's the episode
  // code ("S1E4") instead of the (arbitrary-length, sometimes spoiler-y)
  // episode name; movies never set badge, so this is always their full
  // title regardless.
  primaryText?: string;
}) {
  const { scale, onPressIn, onPressOut } = useScalePress(0.97);

  return (
    <Pressable onPressIn={onPressIn} onPressOut={onPressOut} onPress={onPress ?? item.onPress}>
      <Animated.View style={[styles.itemRow, compact && styles.itemRowCompact, { transform: [{ scale }] }]}>
        {item.imageUrl ? (
          <Image
            source={{ uri: item.imageUrl }}
            style={[styles.itemThumb, compact && styles.itemThumbCompact]}
            contentFit="cover"
          />
        ) : (
          <View
            style={[styles.itemThumb, compact && styles.itemThumbCompact, { backgroundColor: colors.backgroundAlt }]}
          />
        )}
        <View style={styles.itemInfo}>
          {/* No numberOfLines here — wraps instead of truncating, so the
              full movie/show name is always readable regardless of how
              narrow the row is (see the compact prop above). */}
          <Text style={styles.itemTitle}>{primaryText ?? item.title}</Text>
          {!!item.subtitle && (
            <Text style={styles.itemSubtitle} numberOfLines={1}>
              {item.subtitle}
            </Text>
          )}
        </View>
      </Animated.View>
    </Pressable>
  );
}

function createStyles(colors: Colors) {
  return StyleSheet.create({
    toggleRow: {
      flexDirection: "row",
      alignSelf: "center",
      backgroundColor: colors.backgroundAlt,
      borderRadius: radius.pill,
      padding: 3,
      gap: 3,
      marginBottom: 16,
    },
    // Overrides toggleRow's centering/spacing when the toggle is placed
    // inline in the screen's own header row (see CalendarGranularityToggle)
    // instead of stacked above the grid.
    toggleRowInline: { alignSelf: "flex-start", marginBottom: 0 },
    toggleBtn: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: radius.pill },
    toggleBtnActive: { backgroundColor: colors.accent },
    toggleText: { fontSize: type.caption, fontWeight: "700", color: colors.textMuted },
    toggleTextActive: { color: colors.onAccent },
    navRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    navLabel: { fontSize: type.subtitle, fontWeight: "800", color: colors.text, textTransform: "capitalize" },
    // Groups the (conditional) Today button with the forward chevron so
    // both sit past the label — only shown once you've actually navigated
    // away from the current month/week (see isCurrentPeriod above).
    navRightGroup: { flexDirection: "row", alignItems: "center", gap: 10 },
    todayBtn: {
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
    },
    todayBtnText: { fontSize: type.caption, fontWeight: "700", color: colors.accent },
    // flex: 1 (rather than a fixed height) so the grid grows to fill
    // whatever vertical space the screen gives this component — see the
    // `style` prop above.
    monthGrid: { flex: 1, gap: 6 },
    weekdayRow: { flexDirection: "row", gap: 4 },
    weekdayLabel: {
      flex: 1,
      textAlign: "center",
      fontSize: type.micro,
      fontWeight: "700",
      color: colors.textFaint,
      textTransform: "uppercase",
    },
    // Six explicit week rows, each flex: 1, rather than a flex-wrap of 42
    // square cells — that's what lets a cell's height track the available
    // screen space instead of being capped by its own width.
    gridBody: { flex: 1, gap: 4 },
    gridRow: { flex: 1, flexDirection: "row", gap: 4 },
    dayCell: { flex: 1 },
    dayCellInner: {
      flex: 1,
      borderRadius: radius.sm,
      overflow: "hidden",
      padding: 2,
      gap: 1,
    },
    // Today shouldn't only read from its small number pill — a tinted fill
    // + border across the whole cell makes it findable at a glance.
    dayCellInnerToday: {
      backgroundColor: colors.accentSoft,
      borderWidth: 1.5,
      borderColor: colors.accent,
    },
    // Day number: plain text pinned top-left of the cell — a filled pill
    // only for today — never a full-cell overlay, so it stays out of the
    // way of the group list below it.
    dayNumberPill: {
      alignSelf: "flex-start",
      minWidth: 16,
      height: 16,
      borderRadius: radius.pill,
      paddingHorizontal: 4,
      alignItems: "center",
      justifyContent: "center",
    },
    dayNumberPillToday: { backgroundColor: colors.accent },
    dayNumberText: { fontSize: 10, fontWeight: "700", color: colors.text },
    dayNumberTextFaded: { color: colors.textFaint },
    dayNumberTextToday: { color: colors.onAccent, fontWeight: "800" },
    // One tile per show (see groupDayItems) rather than a single full-cell
    // image, or bubble+text sharing one cramped row — putting the episode
    // code in its *own* line under the bubble, instead of squeezed beside
    // it, is what keeps it legible once the cell is phone-narrow. Tiles wrap
    // to a second line by themselves on narrow columns rather than
    // overflowing, so this scales down to a phone column on its own.
    // alignContent: flex-start (not "center") — on a tall row (the grid
    // fills the screen, so a day with only 1-2 shows has a lot of leftover
    // vertical room) centering left the tile floating in a sea of padding.
    // Packing tiles to the top instead keeps them compact right under the
    // day number, and any leftover height just becomes quiet space below.
    dayGroupList: { flex: 1, flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", gap: 4 },
    dayGroupTile: { width: 30, alignItems: "center", gap: 1 },
    dayGroupBubbleWrap: { width: 24, height: 24, position: "relative" },
    dayGroupBubble: { width: 24, height: 24, borderRadius: radius.pill },
    // Green ring = already watched, muted ring = not yet — see
    // CalendarItem.watched. Only drawn when a caller actually sets it.
    dayGroupBubbleWatched: { borderWidth: 2, borderColor: colors.green },
    dayGroupBubbleUnwatched: { borderWidth: 2, borderColor: colors.textFaint },
    dayGroupLabel: { fontSize: 9, fontWeight: "700", color: colors.text, textAlign: "center" },
    // A same-show rewatch/double-episode count (bottom-right) and/or a
    // "there are other shows today too" count (top-right, dayGroupBadgeTop)
    // overlapping the one bubble's corners — a solid accent fill rather
    // than the earlier pale accentSoft "+N" tile, which all but
    // disappeared against the cell's own light background.
    dayGroupBadge: {
      position: "absolute",
      minWidth: 12,
      height: 12,
      borderRadius: radius.pill,
      paddingHorizontal: 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accent,
    },
    dayGroupBadgeBottom: { bottom: -2, right: -2 },
    dayGroupBadgeTop: { top: -2, right: -2 },
    dayGroupBadgeText: { fontSize: 7, fontWeight: "800", color: colors.onAccent },
    // The wide-layout "+N other shows" tile — same footprint as a real
    // bubble so it wraps into the row exactly like one, just a solid accent
    // fill (not the pale accentSoft tried earlier, which barely showed up
    // against the cell's own light background) so the count stays legible.
    dayGroupMoreBubble: {
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    dayGroupMoreText: { fontSize: 10, fontWeight: "800", color: colors.onAccent },
    weekAgenda: { gap: 20 },
    weekDaySection: { gap: 8 },
    weekDayHeader: { flexDirection: "row", alignItems: "baseline", gap: 8 },
    weekDayLabel: { fontSize: type.body, fontWeight: "800", color: colors.text, textTransform: "capitalize" },
    weekDayLabelToday: { color: colors.accent },
    weekDayDate: { fontSize: type.caption, color: colors.textMuted },
    weekEmptyText: { fontSize: type.bodySm, color: colors.textFaint, paddingVertical: 4 },
    // Wide (desktop/tablet) week view: 7 day-columns side by side instead
    // of the stacked day sections mobile keeps (weekAgenda above).
    weekRowWide: { flexDirection: "row", gap: spacing(2) },
    weekColumnWide: { flex: 1, gap: 8, minWidth: 0 },
    weekColumnHeader: { alignItems: "center", gap: 2, marginBottom: 4 },
    weekColumnDayLabel: { fontSize: type.caption, fontWeight: "800", color: colors.text, textTransform: "capitalize" },
    weekColumnDateLabel: { fontSize: type.micro, color: colors.textMuted },
    weekEmptyTextWide: { fontSize: type.micro, color: colors.textFaint, textAlign: "center" },
    sheetScroll: { maxHeight: 320 },
    popoverBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
    popoverCard: {
      position: "absolute",
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: 10,
      ...dropShadow({ opacity: 0.28, radius: 20, offsetY: 6, elevation: 10 }),
    },
    popoverArrow: {
      position: "absolute",
      width: 12,
      height: 12,
      borderRadius: 2,
      backgroundColor: colors.surface,
      transform: [{ rotate: "45deg" }],
    },
    popoverArrowUp: { top: -6 },
    popoverArrowDown: { bottom: -6 },
    itemRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: 8,
      marginBottom: spacing(2),
      ...dropShadow({ opacity: 0.06, radius: 6, offsetY: 2, elevation: 1 }),
    },
    itemThumb: { width: 44, height: 44, borderRadius: radius.sm },
    // See CalendarItemRow's `compact` prop — used only in the wide week
    // view's narrow columns.
    itemRowCompact: { gap: 8, padding: 6 },
    itemThumbCompact: { width: 30, height: 30 },
    itemInfo: { flex: 1, gap: 2, minWidth: 0 },
    itemTitle: { fontSize: type.bodySm, fontWeight: "700", color: colors.text },
    itemSubtitle: { fontSize: type.caption, color: colors.textMuted },
  });
}
