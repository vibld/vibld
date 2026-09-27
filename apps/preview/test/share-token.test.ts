import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  randomShareId,
  signShare,
  verifyShare,
} from '../worker/share-token.ts';

const SECRET = 's3cr3t-signing-key';

describe('randomShareId', () => {
  it('produces unguessable, URL-safe, distinct ids', () => {
    const a = randomShareId();
    const b = randomShareId();
    assert.notEqual(a, b);
    assert.match(a, /^[A-Za-z0-9_-]+$/);
    // 16 random bytes, base64url, unpadded.
    assert.ok(a.length >= 20);
  });
});

describe('signShare / verifyShare', () => {
  it('round-trips a signature for the exact id and expiry it was signed with', async () => {
    const signature = await signShare(SECRET, 'share_1', 1_800_000_000_000);
    assert.equal(
      await verifyShare(SECRET, 'share_1', 1_800_000_000_000, signature),
      true,
    );
  });

  it('rejects a signature checked against a different share id', async () => {
    const signature = await signShare(SECRET, 'share_1', 1_800_000_000_000);
    assert.equal(
      await verifyShare(SECRET, 'share_2', 1_800_000_000_000, signature),
      false,
    );
  });

  it('rejects a signature checked against a tampered expiry', async () => {
    const signature = await signShare(SECRET, 'share_1', 1_800_000_000_000);
    assert.equal(
      await verifyShare(SECRET, 'share_1', 1_800_000_099_999, signature),
      false,
    );
  });

  it('rejects a signature made with a different secret', async () => {
    const signature = await signShare(SECRET, 'share_1', 1_800_000_000_000);
    assert.equal(
      await verifyShare(
        'a-different-secret',
        'share_1',
        1_800_000_000_000,
        signature,
      ),
      false,
    );
  });

  it('rejects garbage that is not valid base64url', async () => {
    assert.equal(
      await verifyShare(
        SECRET,
        'share_1',
        1_800_000_000_000,
        'not!valid!base64',
      ),
      false,
    );
  });

  it('rejects an empty signature', async () => {
    assert.equal(
      await verifyShare(SECRET, 'share_1', 1_800_000_000_000, ''),
      false,
    );
  });
});
