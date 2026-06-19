/**
 * Tiny async worker pool with a concurrency cap. Shared by the eval runner and
 * the prompt A/B experiment runner (extracted in 4B so both use one copy).
 */
export async function pool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function run(): Promise<void> {
    for (;;) {
      const idx = next++
      if (idx >= items.length) return
      results[idx] = await worker(items[idx]!)
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run())
  await Promise.all(runners)
  return results
}
