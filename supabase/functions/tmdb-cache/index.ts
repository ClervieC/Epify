// Deploy with: npx supabase functions deploy tmdb-cache
// Requires SUPABASE_SERVICE_ROLE_KEY (see delete-account's header comment)
// and TMDB_API_KEY as secrets for this project — TMDB_API_KEY is the same
// value as the app's EXPO_PUBLIC_TMDB_API_KEY (public by TMDB's own API-key
// model, already exposed in the client bundle), just under this function's
// own env var name since Deno's runtime here doesn't see Expo's env vars.
//
// A shared, cross-user, generic read-through cache for TMDB — every GET
// path (movie/show details, cast, trailers, watch providers, recommend-
// ations, the popular/top-rated/upcoming lists, search...) gets cached in
// tmdb_api_cache (supabase/schema.sql) keyed by its exact path + query
// string, mirroring however lib/tmdb.ts already keys its own local cache.
// Unlike TVmaze, which rate-limits per caller IP, TMDB's key is a single
// app-wide bucket shared by every user — so at scale this one matters even
// more: the first request for a given path, from anyone, populates the row
// here, and everyone else reads it back from Postgres instead of spending
// more of that one shared budget. Writes need the service role key (RLS on
// tmdb_api_cache only grants `authenticated` select) — this function is the
// only writer, so a buggy/malicious client can never poison what every
// other user reads.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflight } from "../_shared/cors.ts";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
// Caller passes its own ttlMs (matching whatever TTL lib/tmdb.ts's local
// withCache already uses for that same path) — clamped to this ceiling so
// a client bug can't ask this function to treat month-old data as fresh.
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

// This function only ever proxies a GET to TMDB's own API for the small set
// of paths lib/tmdb.ts actually calls — restricting to these prefixes
// (rather than accepting any string) keeps an authenticated-but-malicious
// client from turning this into a general-purpose fetch relay or spamming
// the cache table with unbounded distinct junk paths.
const ALLOWED_PREFIXES = ["/movie", "/tv", "/search", "/discover", "/find"];

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
  const tmdbApiKey = Deno.env.get("TMDB_API_KEY")!;

  // Confirms the caller actually has a valid session — same reasoning as
  // delete-account: don't let an unauthenticated request drive TMDB calls
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
    .from("tmdb_api_cache")
    .select("payload, fetched_at")
    .eq("path", path)
    .maybeSingle();

  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < ttl) {
    return new Response(JSON.stringify({ payload: cached.payload, fromCache: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // `path` already carries its own query string (built client-side, see
  // lib/tmdb.ts) — the API key is appended here rather than by the caller,
  // so it's never part of the cache key or logged from the client side.
  const separator = path.includes("?") ? "&" : "?";
  const tmdbRes = await fetch(`${TMDB_BASE_URL}${path}${separator}api_key=${tmdbApiKey}`);
  if (!tmdbRes.ok) {
    // TMDB is down, or the id is bad — fall back to whatever's cached, even
    // if stale, rather than surface an error the caller can't recover from
    // (mirrors lib/tmdb.ts's own stale-on-error fallback).
    if (cached) {
      return new Response(JSON.stringify({ payload: cached.payload, fromCache: true, stale: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: `TMDB responded ${tmdbRes.status}` }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const payload = await tmdbRes.json();
  // Upsert failing (e.g. a transient DB hiccup) shouldn't block returning
  // the freshly-fetched data to the caller — it just means the next request
  // for this path re-fetches from TMDB too, same as today.
  const { error: upsertError } = await adminClient
    .from("tmdb_api_cache")
    .upsert({ path, payload, fetched_at: new Date().toISOString() });
  if (upsertError) console.error(`tmdb-cache upsert failed for ${path}`, upsertError);

  return new Response(JSON.stringify({ payload, fromCache: false }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
