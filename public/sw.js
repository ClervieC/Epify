// App-shell caching for the web build — specifically to speed up reopening
// the site from an iOS "Add to Home Screen" icon after it's been fully
// quit (not just backgrounded). iOS kills a home-screen web app's process
// far more aggressively than it does a native app, so on iOS "fully quit"
// is the *normal* case, not an edge case — without this, every single
// reopen re-downloads and re-parses the entire JS/CSS bundle from the
// network before the app can even start booting, even though the actual
// show/episode data is already sitting in IndexedDB from last time (see
// lib/showDataCache.ts and friends) and doesn't need the network at all.
//
// Strategy, deliberately simple rather than a full Workbox setup:
//   - The navigation request (index.html) is network-first: always try the
//     network so a fresh visit gets the latest build (which references the
//     latest hashed JS/CSS filenames), falling back to whatever's cached
//     only when there's no network at all.
//   - Every other same-origin GET (the hashed, content-addressed JS/CSS/
//     image files `expo export` produces) is cache-first: once fetched
//     once, it loads instantly from disk on every later visit, cold start
//     included. Safe to cache indefinitely — a changed file gets a new
//     hashed filename, so this never serves stale *content* under a
//     filename that's supposed to have changed.
//   - Anything cross-origin (Supabase, TVmaze, TMDB) is left completely
//     alone — every same-origin request from this site is a static asset
//     (there is no same-origin API), and the app already has its own,
//     much more deliberate caching for that data. A service worker
//     double-caching auth/API calls would be actively harmful, not helpful.
//   - /version.json is explicitly never cached — lib/versionCheck.ts polls
//     it with `cache: "no-store"` specifically to detect a new deploy and
//     force-reload a stale open tab; a service worker silently serving a
//     cached copy of that exact file would defeat the one mechanism this
//     app already has for recovering from a stale build.

const CACHE_NAME = "epify-shell-v1";

self.addEventListener("install", (event) => {
  // Take over immediately rather than waiting for every open tab to close
  // first — this cache only ever fills in as pages are actually visited
  // (see fetch handler below), so there's nothing to pre-warm here.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Caches `request` -> `response` without letting the browser tear the
// service worker down mid-write. Cache Storage writes are async (backed by
// IndexedDB under the hood) — a bare, un-awaited `caches.open().then(...)`
// inside a fetch handler can get killed partway through as soon as
// `respondWith`'s own promise resolves, since nothing was holding the
// worker alive for it. event.waitUntil() fixes that by telling the browser
// this fetch event isn't "done" until the promise passed to it settles.
function cachePut(event, request, response) {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, response)));
}

// Every response here carries `Vary: Accept-Encoding` (Vercel's default),
// and Cache.match()'s default ignoreVary:false compares that header between
// the *original* stored request and whatever request is doing the lookup —
// a plain string like caches.match("/") constructs a fresh Request with no
// Accept-Encoding header at all, which never matches the real browser-set
// one on the stored entry. The result, found the hard way while testing
// this offline: the entry was genuinely there (cache.keys() listed it) but
// every match() call still came back empty. `{ ignoreVary: true }` is the
// fix — match purely on URL, which is exactly the semantics an app-shell
// cache actually wants here.
function cacheMatch(request) {
  return caches.match(request, { ignoreVary: true });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/version.json") return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          cachePut(event, request, response.clone());
          return response;
        } catch {
          // No network at all (offline, or iOS reopened the PWA before
          // connectivity came back) — `request` itself (e.g. /login, a
          // client-side route with nothing fetched under that exact URL)
          // is very unlikely to be a cache hit, so this falls through to
          // "/", the one navigation actually cached — better to boot the
          // app shell against a route it'll immediately redirect from than
          // show a bare connection-error page.
          const cached = await cacheMatch(request);
          return cached ?? (await cacheMatch("/")) ?? Response.error();
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await cacheMatch(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cachePut(event, request, response.clone());
      return response;
    })()
  );
});
