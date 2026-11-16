import { router } from "expo-router";
import type { TabName } from "../components/BottomTabBar";

// Per-tab history without per-tab stacks. Every detail screen is a sibling
// of (tabs) in the root Stack (app/_layout.tsx), so leaving one through the
// tab bar used to throw away the whole path — Explore → Netflix → a show,
// then Shows and back to Explore, landed on Explore's top instead of the
// show. expo-router's own answer (shared routes in one stack per tab) is
// native-only, and this app ships on web too, so instead the screens above
// (tabs) are remembered for the tab they were opened from and pushed back
// when that tab is picked again.

interface SavedRoute {
  name: string;
  params?: Record<string, unknown>;
}

interface RouteLike {
  name: string;
  params?: object;
  state?: StateLike;
}
interface StateLike {
  routes: RouteLike[];
}

const savedStacks: Partial<Record<TabName, SavedRoute[]>> = {};

function tabHref(tab: TabName) {
  return (tab === "index" ? "/(tabs)" : `/(tabs)/${tab}`) as never;
}

// Route names are file paths ("show/[id]", "users/[id]/index"); the href is
// the same path minus a trailing index segment.
function routeHref(route: SavedRoute) {
  const pathname = "/" + route.name.replace(/(^|\/)index$/, "");
  return { pathname, params: route.params ?? {} } as never;
}

// The stack that holds (tabs) — the root one, but looked up rather than
// assumed, since expo-router can wrap it in a navigator of its own.
function screensAboveTabs(state: StateLike | undefined): RouteLike[] | null {
  if (!state) return null;
  const tabsIndex = state.routes.findIndex((r) => r.name === "(tabs)");
  if (tabsIndex >= 0) return state.routes.slice(tabsIndex + 1);
  for (const r of state.routes) {
    const found = screensAboveTabs(r.state);
    if (found) return found;
  }
  return null;
}

// From a screen above (tabs): `from` is the tab it was opened from.
// Same tab → back to its top (and forget its saved path), like tapping the
// current tab on iOS. Another tab → remember this path for `from`, then go
// to `to` and rebuild whatever was saved for it.
export function switchTabFromStack(rootState: StateLike | undefined, from: TabName, to: TabName) {
  const above = screensAboveTabs(rootState) ?? [];
  if (to === from) {
    delete savedStacks[from];
    router.dismissTo(tabHref(to));
    return;
  }
  if (above.length > 0) {
    savedStacks[from] = above.map((r) => ({ name: r.name, params: r.params as Record<string, unknown> | undefined }));
  }
  router.dismissTo(tabHref(to));
  restore(to);
}

// From the (tabs) bar itself, after the tab switch: rebuild `to`'s saved
// path, if it has one.
export function restoreTabStack(to: TabName) {
  restore(to);
}

function restore(tab: TabName) {
  const stack = savedStacks[tab];
  if (!stack) return;
  delete savedStacks[tab];
  for (const route of stack) router.push(routeHref(route));
}

// Sign-out: the saved paths belong to the previous account.
export function clearTabStacks() {
  for (const k of Object.keys(savedStacks) as TabName[]) delete savedStacks[k];
}
