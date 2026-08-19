// Shared Redis client for edge functions that read/write a co-located
// cache (see tmdb-cache/index.ts). Redis lives as a standalone container on
// this project's Docker network (not managed by the Supabase CLI — see
// deployment notes in tmdb-cache's own comment), resolvable as `redis` by
// its network alias. Both functions fail soft: a Redis outage degrades to
// "always a cache miss" (tmdb-cache falls back to its Postgres read, or a
// live TMDB fetch), never a hard error.
import { connect, type Redis } from "jsr:@db/redis@^0.41";

let client: Redis | null = null;
let connecting: Promise<Redis> | null = null;

async function getClient(): Promise<Redis> {
  if (client) return client;
  connecting ??= connect({
    hostname: Deno.env.get("REDIS_HOST") ?? "redis",
    port: Number(Deno.env.get("REDIS_PORT") ?? "6379"),
    password: Deno.env.get("REDIS_PASSWORD")!,
  }).then((c) => (client = c));
  return connecting;
}

export async function cacheGet(key: string): Promise<string | null> {
  try {
    return await (await getClient()).get(key);
  } catch (err) {
    console.error("redis get failed", err);
    return null; // treated exactly like a cache miss by callers
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    await (await getClient()).setex(key, ttlSeconds, value);
  } catch (err) {
    console.error("redis set failed", err);
  }
}
