import assert from 'node:assert/strict';

// Keep the original warmup and budget, but preserve sample order: reclamation is
// not growth. A later rise is measured from the lowest preceding post-warmup RSS.
export function assertBoundedRssGrowth(rss) {
  const warmupCalls = 3;
  const budgetBytes = 64 * 1024 * 1024;
  assert.ok(rss.length > warmupCalls, 'RSS measurements must include calls after warmup.');
  let minimum = rss[warmupCalls];
  let growthBytes = 0;
  for (const bytes of rss.slice(warmupCalls)) {
    growthBytes = Math.max(growthBytes, bytes - minimum);
    minimum = Math.min(minimum, bytes);
  }
  const measurement = { warmupCalls, budgetBytes, growthBytes };
  assert.ok(
    growthBytes < budgetBytes,
    `Post-warmup RSS growth exceeded the budget: ${JSON.stringify({
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      ...measurement,
      rssBytes: rss,
    })}`,
  );
  return measurement;
}
