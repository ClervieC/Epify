import { useRouter } from "expo-router";

// router.back() walks the in-app navigation history, which on web is backed
// by browser history — a hard refresh on any detail page (show/[id],
// episode/[id], stats/shows, ...) wipes that history down to just the
// current URL, so canGoBack() is false and back() is a silent no-op (or, if
// there happened to be a real page before the app in browser history,
// navigates *outside* the app entirely). Every screen with a back button
// should use this instead of calling router.back() directly, so a refreshed
// page still has somewhere sensible to go.
export function useGoBack(fallback: string) {
  const router = useRouter();
  return () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(fallback as Parameters<typeof router.replace>[0]);
    }
  };
}
