// Plain fetch() never times out on its own — a dead/stalled connection (as
// opposed to an outright network error, which rejects immediately) just
// hangs the returned promise forever. Every direct fetch() in this app (TVmaze,
// TMDB, and Supabase's own client — see lib/tvmaze.ts, lib/tmdb.ts,
// lib/supabase.ts) goes through this instead, so a stalled request surfaces
// as a normal rejected promise after a bounded wait — which the existing
// retry/fallback-to-cache logic in each of those already knows how to
// handle — rather than leaving a screen stuck loading indefinitely.
const DEFAULT_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
