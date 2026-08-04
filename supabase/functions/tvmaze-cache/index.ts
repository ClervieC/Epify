// Deploy with: npx supabase functions deploy tvmaze-cache
// Requires SUPABASE_SERVICE_ROLE_KEY to be set as a secret for this project
// (see delete-account's header comment for how to check/set it).
//
// A shared, cross-user, generic read-through cache for TVmaze — every GET
// path (show details, episodes, cast, search, the shows index, the daily
// schedule...) gets cached in tvmaze_api_cache (supabase/schema.sql) keyed
// by its exact path, mirroring however lib/tvmaze.ts already keys its own
// local cache. Every device used to hit TVmaze directly, each paying its
// own slice of TVmaze's ~20 req/10s per-IP rate limit independently, for
// data that's identical for everyone. The first request for a given path,
// from anyone, populates the row here; everyone else (and every fresh
// install / cleared local cache) reads it back from Postgres instead of
// calling TVmaze again. Writes need the service role key (RLS on
// tvmaze_api_cache only grants `authenticated` select) — this function is
// the only writer, so a buggy/malicious client can never poison what every
// other user reads.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";

const TVMAZE_BASE_URL = "https://api.tvmaze.com";
// Caller passes its own ttlMs (matching whatever TTL lib/tvmaze.ts's local
// withCache already uses for that same path) — clamped to this ceiling so
// a client bug can't ask this function to treat month-old data as fresh.
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

// This function only ever proxies a GET to TVmaze's own API for the small
// set of paths lib/tvmaze.ts actually calls — restricting to these prefixes
// (rather than accepting any string) keeps an authenticated-but-malicious
// client from turning this into a general-purpose fetch relay or spamming
// the cache table with unbounded distinct junk paths.
const ALLOWED_PREFIXES = ["/shows", "/episodes/", "/search/shows", "/schedule", "/lookup/shows"];

function isAllowedPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  return ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  let body: { path?: string; ttlMs?: number };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400, headers: corsHeaders });
  }
  const { path, ttlMs } = body;
  if (typeof path !== "string" || !isAllowedPath(path)) {
    return new Response("Invalid path", { status: 400, headers: corsHeaders });
  }
  const ttl = Math.min(typeof ttlMs === "number" && ttlMs > 0 ? ttlMs : MAX_TTL_MS, MAX_TTL_MS);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Confirms the caller actually has a valid session — same reasoning as
  // delete-account: don't let an unauthenticated request drive TVmaze calls
  // or table writes through this function.
  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData.user) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: cached } = await adminClient
    .from("tvmaze_api_cache")
    .select("payload, fetched_at")
    .eq("path", path)
    .maybeSingle();

  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < ttl) {
    return new Response(JSON.stringify({ payload: cached.payload, fromCache: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const tvmazeRes = await fetch(`${TVMAZE_BASE_URL}${path}`);

  // lib/tvmaze.ts's lookupShowByTvdbId treats a 404 as "no match" (returns
  // null), not an error — caching that outcome too (payload: null) avoids
  // this function re-asking TVmaze about a tvdbId that's never going to
  // resolve, the same way a hit below would for any other path.
  if (tvmazeRes.status === 404) {
    const { error: upsertError } = await adminClient
      .from("tvmaze_api_cache")
      .upsert({ path, payload: null, fetched_at: new Date().toISOString() });
    if (upsertError) console.error(`tvmaze-cache upsert (404) failed for ${path}`, upsertError);
    return new Response(JSON.stringify({ payload: null, fromCache: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!tvmazeRes.ok) {
    // TVmaze is down, or a transient error — fall back to whatever's
    // cached, even if stale, rather than surface an error the caller can't
    // recover from (mirrors lib/tvmaze.ts's own stale-on-error fallback).
    if (cached) {
      return new Response(JSON.stringify({ payload: cached.payload, fromCache: true, stale: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: `TVmaze responded ${tvmazeRes.status}` }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const payload = await tvmazeRes.json();
  // Upsert failing (e.g. a transient DB hiccup) shouldn't block returning
  // the freshly-fetched data to the caller — it just means the next request
  // for this path re-fetches from TVmaze too, same as today.
  const { error: upsertError } = await adminClient
    .from("tvmaze_api_cache")
    .upsert({ path, payload, fetched_at: new Date().toISOString() });
  if (upsertError) console.error(`tvmaze-cache upsert failed for ${path}`, upsertError);

  return new Response(JSON.stringify({ payload, fromCache: false }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
