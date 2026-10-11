import { WhistleError } from './errors.js';
import type { Asset, Manifest } from './types.js';
/**
 * Compare complete bytes with locked size/SHA-256 metadata before use.
 * @param bytes - Downloaded or local bytes; caller ownership is retained.
 * @param expected - Trusted compiled integrity metadata.
 * @param name - File label used in errors; not an acquisition URL.
 * @throws WhistleError with ASSET_INTEGRITY_FAILED on either mismatch.
 */
export async function verify(bytes: Uint8Array, expected: Asset, name: string): Promise<void> {
  if (bytes.byteLength !== expected.bytes)
    throw new WhistleError(
      'ASSET_INTEGRITY_FAILED',
      `${name}: size mismatch; prepare matching assets again.`,
    );
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hash !== expected.sha256)
    throw new WhistleError(
      'ASSET_INTEGRITY_FAILED',
      `${name}: SHA-256 mismatch; prepare matching assets again.`,
    );
}
/** Require exact SDK, compatibility and file-integrity metadata before executing assets. */
export function validateManifest(value: unknown, expected: Manifest): asserts value is Manifest {
  const actual = value as Manifest | null;
  if (
    !actual ||
    actual.schemaVersion !== expected.schemaVersion ||
    actual.compatibilityId !== expected.compatibilityId ||
    actual.sdkVersion !== expected.sdkVersion ||
    !actual.files ||
    Object.keys(actual.files).length !== Object.keys(expected.files).length ||
    Object.entries(expected.files).some(
      ([name, asset]) =>
        actual.files[name]?.sha256 !== asset.sha256 || actual.files[name]?.bytes !== asset.bytes,
    )
  )
    throw new WhistleError(
      'ASSET_INCOMPATIBLE',
      'Asset manifest does not match this SDK release; run this package’s whistle download command.',
    );
}
