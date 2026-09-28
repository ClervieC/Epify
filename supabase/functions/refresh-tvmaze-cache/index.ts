// Deploy with: npx supabase functions deploy refresh-tvmaze-cache --no-verify-jwt
// Requires SUPABASE_SERVICE_ROLE_KEY (already set for tmdb-cache/refresh-
// lists) and its own REFRESH_TVMAZE_SECRET as secrets for this project —
// deliberately a *different* secret from refresh-lists' REFRESH_SECRET
// (same reasoning as any credential: one leak shouldn't hand over the
// other job too).
//
// Daily proactive refresh of public.tvmaze_api_cache — every already-cached
// show whose last-known TVmaze status isn't "Ended" (see the query below;
// deliberately not "every show anyone has ever tracked" — see its own
// comment for why), re-fetched from TVmaze and upserted here. This is the
// piece that keeps already-cached shows' episode lists from going stale
// (new episodes airing on an ongoing show), not the piece that makes a
// *new* show available to other users — that happens immediately, client-
// side, the moment anyone's own cache-miss fetch succeeds (see
// lib/tvmaze.ts's writeTvmazeSharedCache). This job's the backstop for
// shows nobody's opened again since they aired a new episode.
//
// Earlier attempt & why this one's different: supabase/schema.sql and this
// function's own former header both documented a prior tvmaze_show_cache/
// tvmaze_episodes_cache (and later a generic tvmaze_api_cache) being
// reverted after a load test found the Edge Function path serializing
// badly under concurrency — multi-second latency past ~20 simultaneous
// *client* requests, from the self-hosted Deno edge-runtime's own
// per_worker concurrency policy (see tmdb-cache/index.ts's identical
// finding, fixed there by reading tmdb_api_cache directly via PostgREST
// instead of through this kind of function). That failure mode needed many
// concurrent callers hitting the function — it never applies here, since
// this function is only ever invoked once a day, by pg_cron, never by a
// client (see lib/tvmaze.ts, which reads tvmaze_api_cache directly via
// PostgREST and never calls this function at all). A single invocation
// processing many shows sequentially has nothing to serialize *against*.
//
// Deployed with --no-verify-jwt (no real user session involved) and gated
// by a shared secret header only the scheduled pg_cron call knows, so an
// ordinary client can't hit this endpoint to force a bulk TVmaze refresh
// on demand.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TVMAZE_BASE_URL = "https://api.tvmaze.com";
// TVmaze's public rate limit is ~20 req/10s per caller IP. This job issues
// two requests per show (info + episodes) with no interactive user
// waiting, so it can afford to pace itself well under that ceiling rather
// than racing it — a slow, reliable nightly pass beats a fast one that
// starts drawing 429s partway through.
const REQUEST_DELAY_MS = 700;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAndCache(admin: ReturnType<typeof createClient>, path: string): Promise<"ok" | string> {
  try {
    const res = await fetch(`${TVMAZE_BASE_URL}${path}`);
    if (!res.ok) throw new Error(`TVmaze responded ${res.status}`);
    const payload = await res.json();
    const { error } = await admin
      .from("tvmaze_api_cache")
      .upsert({ path, payload, fetched_at: new Date().toISOString() });
    if (error) throw error;
    return "ok";
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const expectedSecret = Deno.env.get("REFRESH_TVMAZE_SECRET")!;
  if (req.headers.get("X-Refresh-Secret") !== expectedSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Deliberately NOT "every show anyone has ever tracked" (select distinct
  // tvmaze_id from user_shows) — found the hard way running this for real
  // on this project's actual data: 1783 distinct shows, which at a safe
  // TVmaze pace would take ~40 minutes in one sequential invocation, most
  // of it wasted on shows that can never produce a new episode again.
  // Instead: shows *already* in tvmaze_api_cache (i.e. someone's opened
  // them at least once, so a stale copy actually matters to someone) whose
  // last-known status isn't "Ended" — an Ended show's episode list is
  // permanently fixed, so re-fetching it daily forever is pure waste. A
  // show that's never been cached at all doesn't need backfilling here
  // either — that happens immediately, client-side, on its own first
  // cache-miss (see lib/tvmaze.ts's writeTvmazeSharedCache), not this job.
  const { data: cachedShowRows, error: cacheError } = await admin
    .from("tvmaze_api_cache")
    .select("path, payload")
    .like("path", "/shows/%");
  if (cacheError) {
    return new Response(JSON.stringify({ error: cacheError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const showIdPattern = /^\/shows\/(\d+)$/;
  const showIds: number[] = [];
  for (const row of cachedShowRows ?? []) {
    const match = showIdPattern.exec(row.path);
    if (!match) continue; // skips this same show's own .../episodes row
    const status = (row.payload as { status?: string } | null)?.status;
    if (status === "Ended") continue;
    showIds.push(Number(match[1]));
  }

  const results: Record<string, string> = {};
  for (const id of showIds) {
    results[`/shows/${id}`] = await fetchAndCache(admin, `/shows/${id}`);
    await sleep(REQUEST_DELAY_MS);
    results[`/shows/${id}/episodes`] = await fetchAndCache(admin, `/shows/${id}/episodes`);
    await sleep(REQUEST_DELAY_MS);
  }

  return new Response(JSON.stringify({ showCount: showIds.length, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
