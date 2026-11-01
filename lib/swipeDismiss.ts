// Put on a view whose own swipe-down gesture means "close" (the hero of
// show/episode/movie detail — see useSwipeDownToDismiss) so the web
// pull-to-refresh (components/PullToRefresh.web.tsx) leaves touches
// starting there alone. Harmless on native, where it's just a test id.
export const SWIPE_DISMISS_NATIVE_ID = "swipe-dismiss";
