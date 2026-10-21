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
// Also refreshes public.tmdb_tvmaze_resolved (Explore's "already in my
// list" TMDB->TVmaze id cache, see lib/tmdb.ts's fetchResolvedTvmazeShows)
// — a show's TVmaze *identity* there never changes once resolved, but the
// snapshotted name/image/status can drift (a rename, a poster refresh, a
// status change once a show ends), so this is the same backstop for that
// table instead of a separate cron entry for it.
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

type SupabaseAdmin = ReturnType<typeof createClient>;

const TVMAZE_BASE_URL = "https://api.tvmaze.com";
// TVmaze's public rate limit is ~20 req/10s per caller IP. This job issues
// up to two requests per show (info + episodes) with no interactive user
// waiting, so it can afford to pace itself well under that ceiling rather
// than racing it — a slow, reliable nightly pass beats a fast one that
// starts drawing 429s partway through.
const REQUEST_DELAY_MS = 700;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTvmazePayload(path: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${TVMAZE_BASE_URL}${path}`);
    if (!res.ok) throw new Error(`TVmaze responded ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

async function upsertApiCache(admin: SupabaseAdmin, path: string, payload: unknown): Promise<"ok" | string> {
  const { error } = await admin.from("tvmaze_api_cache").upsert({ path, payload, fetched_at: new Date().toISOString() });
  return error ? `error: ${error.message}` : "ok";
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
  const trackedShowIds = new Set<number>();
  for (const row of cachedShowRows ?? []) {
    const match = showIdPattern.exec(row.path as string);
    if (!match) continue; // skips this same show's own .../episodes row
    const status = (row.payload as { status?: string } | null)?.status;
    if (status === "Ended") continue;
    trackedShowIds.add(Number(match[1]));
  }

  // Same "skip Ended" shortcut as above — a finished show's name/image
  // essentially never changes again either, so there's nothing worth
  // re-fetching daily forever.
  const { data: resolvedRows, error: resolvedError } = await admin
    .from("tmdb_tvmaze_resolved")
    .select("tmdb_tv_id, tvmaze_show");
  const tmdbIdsByTvmazeId = new Map<number, number[]>();
  if (!resolvedError) {
    for (const row of resolvedRows ?? []) {
      const show = row.tvmaze_show as { id?: number; status?: string } | null;
      if (!show?.id || show.status === "Ended") continue;
      const list = tmdbIdsByTvmazeId.get(show.id) ?? [];
      list.push(row.tmdb_tv_id as number);
      tmdbIdsByTvmazeId.set(show.id, list);
    }
  }

  // Union so a show present in both sources (common — a popular show is
  // likely both someone's tracked show and one of Explore's discover-
  // category cards) only costs one /shows/{id} fetch, not two.
  const allShowIds = new Set<number>([...trackedShowIds, ...tmdbIdsByTvmazeId.keys()]);

  const results: Record<string, string> = {};
  for (const id of allShowIds) {
    const payload = await fetchTvmazePayload(`/shows/${id}`);
    if (payload) {
      results[`/shows/${id}`] = await upsertApiCache(admin, `/shows/${id}`, payload);

      const tmdbIds = tmdbIdsByTvmazeId.get(id);
      if (tmdbIds && tmdbIds.length > 0) {
        const { error } = await admin
          .from("tmdb_tvmaze_resolved")
          .update({ tvmaze_show: payload, resolved_at: new Date().toISOString() })
          .in("tmdb_tv_id", tmdbIds);
        results[`tmdb_tvmaze_resolved(tvmaze:${id})`] = error ? `error: ${error.message}` : "ok";
      }
    } else {
      results[`/shows/${id}`] = "error: fetch failed";
    }
    await sleep(REQUEST_DELAY_MS);

    // Episodes are only relevant to tvmaze_api_cache (tmdb_tvmaze_resolved
    // doesn't store them), so only fetched for shows that came from there.
    if (trackedShowIds.has(id)) {
      const episodes = await fetchTvmazePayload(`/shows/${id}/episodes`);
      results[`/shows/${id}/episodes`] = episodes
        ? await upsertApiCache(admin, `/shows/${id}/episodes`, episodes)
        : "error: fetch failed";
      await sleep(REQUEST_DELAY_MS);
    }
  }

  return new Response(JSON.stringify({ showCount: allShowIds.size, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
