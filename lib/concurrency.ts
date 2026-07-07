// Runs `worker` over `items` with at most `concurrency` in flight at once, instead of
// firing every call in a single Promise.all. Public APIs like TVmaze rate-limit per IP
// (~20 req/10s for TVmaze) — a handful of lanes running in parallel is still fast but
// doesn't blow through that ceiling the moment a list has more than a few entries.
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runLane() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runLane));
  return results;
}
