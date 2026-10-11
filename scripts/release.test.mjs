import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  packageNames,
  publicationState,
  registryEntry,
  releasePlan,
  verifiedArtifact,
} from './release.mjs';

const pushed = (version) => ({
  event: 'push',
  refType: 'tag',
  refName: `v${version}`,
  dryRun: 'false',
});
test('only matching tags can publish; dispatch on a branch is dry-run only', () => {
  assert.equal(releasePlan('1.2.3', pushed('1.2.3')).npm_tag, 'latest');
  assert.throws(() => releasePlan('1.2.3', pushed('2.0.0')), /must match/);
  assert.throws(
    () => releasePlan('1.2.3', { event: 'push', refType: 'branch', refName: 'main' }),
    /matching/,
  );
  assert.throws(
    () => releasePlan('1.2.3', { event: 'workflow_dispatch', refType: 'branch', dryRun: 'false' }),
    /matching/,
  );
  assert.equal(
    releasePlan('1.2.3', { event: 'workflow_dispatch', refType: 'branch', dryRun: 'true' }).dry_run,
    true,
  );
  for (const version of [
    '01.2.3',
    '1.2',
    '1.2.3-01',
    '1.2.3+build',
    '1.2.3\n',
    '1.2.3\ninjected=true',
  ])
    assert.throws(() => releasePlan(version, pushed(version)));
});

test('prereleases cannot update latest or use invalid numeric dist-tags', () => {
  assert.equal(releasePlan('1.2.3-beta.2', pushed('1.2.3-beta.2')).npm_tag, 'beta');
  for (const suffix of ['1', 'latest', 'v1', 'candidate.1']) {
    const version = `1.2.3-${suffix}`;
    const plan = releasePlan(version, pushed(version));
    assert.equal(plan.npm_tag, 'next');
    assert.equal(plan.prerelease, true);
  }
});

test('registry failures fail closed; reruns skip only identical published bytes', async () => {
  assert.equal(
    await publicationState('1.2.3', 'sha512-test', async () => new Response(null, { status: 404 })),
    'publish',
  );
  assert.equal(
    await publicationState('1.2.3', 'sha512-test', async () =>
      Response.json({ dist: { integrity: 'sha512-test' } }),
    ),
    'skip',
  );
  await assert.rejects(
    publicationState('1.2.3', 'sha512-test', async () =>
      Response.json({ dist: { integrity: 'sha512-other' } }),
    ),
    /different tarball/,
  );
  for (const status of [401, 403, 429, 500, 503])
    await assert.rejects(
      registryEntry('package', async () => new Response(null, { status })),
      /refusing to publish/,
    );
  await assert.rejects(
    registryEntry('package', async () => {
      throw new Error('offline');
    }),
    /offline/,
  );
});

test('artifact identity and bytes must match the version validated before CI', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whistle release '));
  const plan = releasePlan('1.2.3', pushed('1.2.3'));
  const bytes = Buffer.from('deterministic artifact fixture');
  const receipts = packageNames.map((name) => ({
    name,
    version: plan.version,
    filename: `${name.slice(1).replace('/', '-')}-${plan.version}.tgz`,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  }));
  const writeReceipt = () =>
    writeFile(
      join(directory, 'release.json'),
      JSON.stringify({ schemaVersion: 1, packages: receipts }),
    );
  const receipt = receipts[1];
  try {
    for (const item of receipts) await writeFile(join(directory, item.filename), bytes);
    await writeReceipt();
    for (const name of packageNames) await verifiedArtifact(directory, plan, name);
    await writeFile(join(directory, receipt.filename), 'tampered');
    await assert.rejects(verifiedArtifact(directory, plan, '@tiny-stt/react'), /checksum/);
    receipt.filename = '../outside.tgz';
    await writeReceipt();
    await assert.rejects(verifiedArtifact(directory, plan, '@tiny-stt/react'));
    receipt.filename = 'tiny-stt-react-1.2.3.tgz';
    receipt.version = '2.0.0';
    await writeReceipt();
    await assert.rejects(verifiedArtifact(directory, plan, '@tiny-stt/react'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
