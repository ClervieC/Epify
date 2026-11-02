import { TVMazeEpisode } from "./tvmaze";

// Same flat estimate the profile's "watch time" already uses (see
// AVG_EPISODE_MINUTES in app/(tabs)/profile.tsx) — only reached when a show
// has no runtime on any of its episodes at all.
export const DEFAULT_EPISODE_MINUTES = 42;

// TVmaze leaves runtime null on plenty of episodes (mostly not-yet-aired
// ones, sometimes a whole older show). Filling those with the average of
// the show's own known runtimes keeps a 20-minute sitcom from being counted
// as 42-minute episodes.
export function averageRuntime(episodes: TVMazeEpisode[]): number {
  let sum = 0;
  let count = 0;
  for (const e of episodes) {
    if (e.runtime) {
      sum += e.runtime;
      count += 1;
    }
  }
  return count > 0 ? Math.round(sum / count) : DEFAULT_EPISODE_MINUTES;
}

// Total minutes for `episodes`, using `fallback` (usually averageRuntime()
// of the whole show, not just this subset) for any episode without one.
export function totalRuntime(episodes: TVMazeEpisode[], fallback: number): number {
  return episodes.reduce((sum, e) => sum + (e.runtime || fallback), 0);
}
