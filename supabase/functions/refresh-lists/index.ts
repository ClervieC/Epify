// Deploy with: npx supabase functions deploy refresh-lists --no-verify-jwt
// Requires SUPABASE_SERVICE_ROLE_KEY, TMDB_API_KEY (already set for
// tmdb-cache) and REFRESH_SECRET as secrets for this project.
//
// Proactively refreshes the small, fixed set of TMDB "list" endpoints
// (popular/top-rated/now-playing/upcoming, movies and TV) and the TVmaze
// daily schedule — the paths tmdb-cache/tvmaze-cache otherwise only refresh
// *reactively*, whichever user's request happens to land right after the
// previous entry's TTL lapsed (paying that one round trip on their behalf).
// Scheduled once daily via pg_cron + pg_net instead (see supabase/
// schema.sql's cron.schedule call, and vault.create_secret for how the
// secret below gets to it without living in a committed file) — nobody's
// request ever pays for the TVmaze/TMDB round trip, and every row refreshes
// on a predictable clock instead of "whenever someone happens to ask right
// after it goes stale." Everything else (show/movie details, search,
// per-user For You feeds, ...) stays reactive — those are keyed by
// unbounded user input, not this fixed, enumerable set of paths, so there's
// nothing sensible to "pre-warm" for them.
//
// Deployed with --no-verify-jwt (no real user session is ever involved
// here) and gated instead by a shared secret header only the scheduled
// pg_cron call knows, so an ordinary client can't hit this endpoint to
// force-refresh (and burn TMDB's shared budget) on demand.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TVMAZE_BASE_URL = "https://api.tvmaze.com";

// Mirrors exactly what lib/tmdb.ts's cachedMovieList/cachedTvList call for
// the four fixed-path lists per side — keep in sync if either changes.
// getUpcomingTv's path is date-based (see upcomingTvPath below) so it's
// built separately rather than listed here.
const TMDB_LIST_PATHS = [
  "/movie/popular",
  "/movie/top_rated",
  "/movie/now_playing",
  "/movie/upcoming",
  "/tv/popular",
  "/tv/top_rated",
  "/tv/on_the_air",
];

function upcomingTvPath(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `/discover/tv?first_air_date.gte=${today}&sort_by=popularity.desc`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const expectedSecret = Deno.env.get("REFRESH_SECRET")!;
  if (req.headers.get("X-Refresh-Secret") !== expectedSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const tmdbApiKey = Deno.env.get("TMDB_API_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const results: Record<string, string> = {};

  for (const path of [...TMDB_LIST_PATHS, upcomingTvPath()]) {
    try {
      const separator = path.includes("?") ? "&" : "?";
      const res = await fetch(`${TMDB_BASE_URL}${path}${separator}api_key=${tmdbApiKey}`);
      if (!res.ok) throw new Error(`TMDB responded ${res.status}`);
      const payload = await res.json();
      const { error } = await admin
        .from("tmdb_api_cache")
        .upsert({ path, payload, fetched_at: new Date().toISOString() });
      if (error) throw error;
      results[path] = "ok";
    } catch (err) {
      results[path] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // TVmaze's daily schedule, US region — the one caller currently in the
  // app (lib/tvmaze.ts's getTodaySchedule) defaults to "US" too, and it's
  // otherwise unused right now, but refreshing it costs one extra request.
  const schedulePath = "/schedule?country=US";
  try {
    const res = await fetch(`${TVMAZE_BASE_URL}${schedulePath}`);
    if (!res.ok) throw new Error(`TVmaze responded ${res.status}`);
    const payload = await res.json();
    const { error } = await admin
      .from("tvmaze_api_cache")
      .upsert({ path: schedulePath, payload, fetched_at: new Date().toISOString() });
    if (error) throw error;
    results[schedulePath] = "ok";
  } catch (err) {
    results[schedulePath] = `error: ${err instanceof Error ? err.message : String(err)}`;
  }

  return new Response(JSON.stringify({ results }), {
    headers: { "Content-Type": "application/json" },
  });
});
