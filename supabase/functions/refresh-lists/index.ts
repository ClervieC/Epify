// Deploy with: npx supabase functions deploy refresh-lists --no-verify-jwt
// Requires SUPABASE_SERVICE_ROLE_KEY, TMDB_API_KEY, REDIS_PASSWORD (all
// already set for tmdb-cache) and REFRESH_SECRET as secrets for this
// project.
//
// Proactively refreshes the small, fixed set of TMDB "list" endpoints
// (popular/top-rated/now-playing/upcoming, movies and TV) — the paths
// tmdb-cache otherwise only refreshes *reactively*, whichever user's
// request happens to land right after the previous entry's TTL lapsed
// (paying that one round trip on their behalf). Scheduled once daily via
// pg_cron + pg_net instead (see supabase/schema.sql's cron.schedule call,
// and vault.create_secret for how the secret below gets to it without
// living in a committed file) — nobody's request ever pays for the TMDB
// round trip, and every row refreshes on a predictable clock instead of
// "whenever someone happens to ask right after it goes stale." Everything
// else (movie/show details, search, per-user For You feeds, ...) stays
// reactive — those are keyed by unbounded user input, not this fixed,
// enumerable set of paths, so there's nothing sensible to "pre-warm" for
// them.
//
// TVmaze has no equivalent shared-cache Edge Function (see lib/tvmaze.ts —
// the client calls TVmaze directly; a load test found the Edge Function
// path serializing badly under concurrency, multi-second latency past ~20
// simultaneous requests despite near-idle CPU, while TVmaze's own per-IP
// rate limit already gives every device its own budget without needing a
// shared cache the way TMDB's single app-wide key does), so there's
// nothing TVmaze-side left for this job to pre-warm either.
//
// Deployed with --no-verify-jwt (no real user session is ever involved
// here) and gated instead by a shared secret header only the scheduled
// pg_cron call knows, so an ordinary client can't hit this endpoint to
// force-refresh (and burn TMDB's shared budget) on demand.
//
// Writes go to both Redis and Postgres (see tmdb-cache/index.ts's own
// header comment for why — Redis is now tmdb-cache's primary read path,
// dual-written during a bake-in period). This function bypasses
// tmdb-cache's own request path entirely, so without this it would keep
// succeeding every night while silently refreshing only the table nobody
// reads first anymore.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cacheSet } from "../_shared/redis.ts";

const REDIS_TTL_SECONDS = 7 * 24 * 60 * 60;

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

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
      const fetchedAt = new Date().toISOString();
      await cacheSet(`tmdb:${path}`, JSON.stringify({ payload, fetched_at: fetchedAt }), REDIS_TTL_SECONDS);
      const { error } = await admin
        .from("tmdb_api_cache")
        .upsert({ path, payload, fetched_at: fetchedAt });
      if (error) throw error;
      results[path] = "ok";
    } catch (err) {
      results[path] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { "Content-Type": "application/json" },
  });
});
