import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBoundedRssGrowth } from './memory.mjs';

test('RSS gate allows reclamation but rejects subsequent or gradual growth with diagnostics', () => {
  const mib = 1024 * 1024;
  const samples = (values) => [220, 240, 240, ...values].map((value) => value * mib);
  // A >64 MiB decrease used to fail the unordered max-minus-min check.
  assert.equal(assertBoundedRssGrowth(samples([240, 240, 160, 161, 161])).growthBytes, mib);
  assert.equal(assertBoundedRssGrowth(samples([160, 160, 160])).growthBytes, 0);
  for (const values of [
    [160, 180, 200, 224],
    [240, 150, 170, 215],
  ]) {
    const rss = samples(values);
    assert.throws(
      () => assertBoundedRssGrowth(rss),
      (error) => {
        assert.match(error.message, /Post-warmup RSS growth/);
        assert.ok(error.message.includes(JSON.stringify(rss)));
        assert.ok(error.message.includes(process.version));
        assert.ok(error.message.includes(`"budgetBytes":${64 * mib}`));
        return true;
      },
    );
  }
});
