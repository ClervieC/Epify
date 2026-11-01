import { ReactNode } from "react";

// Native: no global pull-to-refresh — that's RefreshControl's job per
// screen there. Metro picks PullToRefresh.web.tsx for web builds.
export function PullToRefresh({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
