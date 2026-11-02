import { TVMazeEpisode } from "./tvmaze";
import { WatchedEpisode } from "./userShows";

// Detects "I'm rewatching this show" purely from watch counts, with no
// explicit rewatch button anywhere: the signal is the pilot (S1E1) having
// been watched again (times_watched >= 2) while some other aired episode is
// still behind that count. Only reachable once every aired episode has been
// watched at least once (see computeEnrichedForShow in app/(tabs)/index.tsx)
// — rewatching the pilot from the show detail page is still a manual first
// step, but every episode after that surfaces back in Watch Next on its
// own, so the user isn't stuck re-finding the show to advance a rewatch
// already in progress.
//
// `stoppedLevel` is user_shows.rewatch_stopped_level: the pilot's
// times_watched at the moment the user said "stop rewatching" (show detail
// menu). That rewatch is over while the pilot is still at that count — e.g.
// rewatched season 1, didn't want the rest — but watching the pilot yet
// again later (count goes past it) is a new rewatch and surfaces as usual.
export function computeRewatchNext(
  aired: TVMazeEpisode[],
  watchedList: WatchedEpisode[],
  stoppedLevel: number | null | undefined,
): { episode: TVMazeEpisode; timesWatched: number; pilotTimes: number } | null {
  const pilot = aired.find((e) => e.season === 1 && e.number === 1);
  if (!pilot) return null;
  const timesById = new Map(watchedList.map((w) => [w.tvmaze_episode_id, w.times_watched]));
  const pilotTimes = timesById.get(pilot.id) ?? 0;
  if (pilotTimes < 2) return null;
  if (stoppedLevel != null && pilotTimes <= stoppedLevel) return null;
  const behind = [...aired]
    .filter((e) => e.id !== pilot.id)
    .sort((a, b) => a.season - b.season || a.number - b.number)
    .find((e) => (timesById.get(e.id) ?? 0) < pilotTimes);
  if (!behind) return null;
  return { episode: behind, timesWatched: timesById.get(behind.id) ?? 0, pilotTimes };
}
