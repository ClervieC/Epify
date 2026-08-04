// Short-TTL, in-memory-only cache-aside for a single current-user value
// that's polled repeatedly across navigations in quick succession (unread
// counts, activity markers, own profile, admin badge counts). Unlike
// lib/showDataCache.ts's long-lived persisted cache (correct via an
// explicit invalidate() call at each specific mutation site), these values
// can change from many different, hard-to-enumerate actions elsewhere in
// the app (someone follows you, comments, replies to a support ticket) —
// chasing every one of those to call invalidate() isn't worth it. A short
// TTL is the simpler, adequate fix: close enough to live to not feel stale,
// while collapsing the burst of duplicate calls that already-existing call
// sites fire on every navigation focus into a single shared round trip.
export function createShortCache<T>(ttlMs: number) {
  let entry: { data: T; expiresAt: number } | null = null;
  let inFlight: Promise<T> | null = null;

  async function getOrFetch(fetcher: () => Promise<T>): Promise<T> {
    if (entry && entry.expiresAt > Date.now()) return entry.data;
    if (inFlight) return inFlight;

    inFlight = fetcher()
      .then((data) => {
        entry = { data, expiresAt: Date.now() + ttlMs };
        return data;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  function invalidate() {
    entry = null;
    inFlight = null;
  }

  return { getOrFetch, invalidate };
}
