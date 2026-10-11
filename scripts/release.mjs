import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const packageNames = ['@tiny-stt/whistle', '@tiny-stt/react'];
const filename = (name, version) => `${name.slice(1).replace('/', '-')}-${version}.tgz`;
const registry = 'https://registry.npmjs.org';

export function releasePlan(version, { event, refType, refName, dryRun }) {
  const number = '(?:0|[1-9][0-9]*)';
  const identifier = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
  const semver = new RegExp(
    `^${number}\\.${number}\\.${number}(?:-(${identifier}(?:\\.${identifier})*))?$`,
  );
  const match = typeof version === 'string' && version.match(semver);
  assert.ok(match && match[0] === version, 'Use a valid SemVer version without build metadata.');
  assert.ok(['push', 'workflow_dispatch'].includes(event), 'Unsupported release event.');
  const preview = event === 'workflow_dispatch' && dryRun === 'true';
  if (refType === 'tag')
    assert.equal(refName, `v${version}`, 'Release tag must match package.json.');
  else assert.ok(preview, 'Real releases require a matching v* tag.');
  const prerelease = Boolean(match[1]);
  const channel = match[1]?.split('.')[0];
  // Numeric or unusual prerelease identifiers must never become invalid npm tags or latest.
  const npmTag = prerelease
    ? ['alpha', 'beta', 'rc', 'next'].includes(channel)
      ? channel
      : 'next'
    : 'latest';
  return {
    version,
    npm_tag: npmTag,
    prerelease,
    dry_run: preview,
  };
}

export async function registryEntry(path, fetcher = fetch) {
  const response = await fetcher(`${registry}/${path}`, { signal: AbortSignal.timeout(15000) });
  if (response.status === 404) return null;
  if (response.status !== 200)
    throw new Error(`npm registry returned HTTP ${response.status}; refusing to publish.`);
  return response.json();
}

export async function publicationState(
  version,
  integrity,
  fetcher = fetch,
  name = packageNames[0],
) {
  const existing = await registryEntry(
    `${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    fetcher,
  );
  if (!existing) return 'publish';
  assert.equal(
    existing.dist?.integrity,
    integrity,
    'This npm version already exists with different tarball bytes.',
  );
  return 'skip';
}

export async function verifiedArtifact(directory, plan, name = packageNames[0]) {
  assert.ok(packageNames.includes(name));
  const manifest = JSON.parse(await readFile(resolve(directory, 'release.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.packages.length, packageNames.length);
  assert.deepEqual(
    manifest.packages.map((pkg) => pkg.name),
    packageNames,
  );
  const receipt = manifest.packages.find((pkg) => pkg.name === name);
  assert.equal(receipt.version, plan.version);
  assert.equal(receipt.filename, filename(name, plan.version));
  const archive = resolve(directory, filename(name, plan.version));
  const integrity = `sha512-${createHash('sha512')
    .update(await readFile(archive))
    .digest('base64')}`;
  assert.equal(receipt.integrity, integrity, 'Artifact checksum does not match CI receipt.');
  return { archive, integrity };
}

async function main() {
  const pkg = JSON.parse(await readFile(resolve(root, 'packages/whistle/package.json'), 'utf8'));
  for (const name of packageNames) {
    const other = JSON.parse(
      await readFile(resolve(root, `packages/${name.split('/')[1]}/package.json`), 'utf8'),
    );
    assert.equal(other.name, name);
    assert.equal(other.version, pkg.version, 'Public packages release in lockstep.');
    assert.equal(other.repository?.url, 'git+https://github.com/tobilg/tiny-stt.git');
    assert.equal(other.repository?.directory, `packages/${name.split('/')[1]}`);
    assert.notEqual(other.private, true);
  }
  assert.equal(pkg.repository?.url, 'git+https://github.com/tobilg/tiny-stt.git');
  assert.equal(pkg.repository?.directory, 'packages/whistle');
  assert.notEqual(pkg.private, true);
  const plan = releasePlan(pkg.version, {
    event: process.env.GITHUB_EVENT_NAME,
    refType: process.env.GITHUB_REF_TYPE,
    refName: process.env.GITHUB_REF_NAME,
    dryRun: process.env.DRY_RUN,
  });
  if (!plan.dry_run)
    assert.equal(
      process.env.GITHUB_REPOSITORY,
      'tobilg/tiny-stt',
      'Real releases must run in tobilg/tiny-stt.',
    );
  if (process.argv[2] === 'version') {
    if (!plan.dry_run) {
      for (const name of packageNames) {
        const existing = await registryEntry(encodeURIComponent(name));
        assert.ok(
          existing,
          `${name} is not on npm yet. Complete the manual first publish and trusted-publisher setup in packages/documentation/guides/releasing.md.`,
        );
      }
    }
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(
        process.env.GITHUB_OUTPUT,
        Object.entries(plan)
          .map(([key, value]) => `${key}=${value}\n`)
          .join(''),
      );
    }
    console.log(JSON.stringify(plan, null, 2));
  } else if (process.argv[2] === 'publish') {
    // Verify every artifact before publishing either package, then publish the SDK first.
    const artifacts = await Promise.all(
      packageNames.map((name) => verifiedArtifact(resolve(root, 'artifacts'), plan, name)),
    );
    const states = await Promise.all(
      artifacts.map(({ integrity }, index) =>
        plan.dry_run
          ? 'publish'
          : publicationState(plan.version, integrity, fetch, packageNames[index]),
      ),
    );
    for (const [index, packageName] of packageNames.entries()) {
      const { archive } = artifacts[index];
      const state = states[index];
      if (state === 'skip')
        console.log(
          `${packageName}@${plan.version} already contains this exact artifact; skipping.`,
        );
      else {
        const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        execFileSync(
          npm,
          [
            'publish',
            archive,
            '--registry',
            registry,
            '--access',
            'public',
            '--tag',
            plan.npm_tag,
            '--ignore-scripts',
            ...(plan.dry_run ? ['--dry-run'] : []),
          ],
          {
            stdio: 'inherit',
            shell: process.platform === 'win32',
          },
        );
      }
      if (process.env.GITHUB_STEP_SUMMARY) {
        await appendFile(
          process.env.GITHUB_STEP_SUMMARY,
          `## ${packageName}\n\nVersion: ${plan.version} · dist-tag: ${plan.npm_tag} · dry run: ${plan.dry_run}\n\nArtifact: the tarball checked by CI; integrity verified before publication.\n`,
        );
      }
    }
  } else throw new Error('Usage: node scripts/release.mjs <version|publish>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
