import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseStartRequest } from '../worker/start-request.ts';

/**
 * What `/internal/preview/start` accepts, and in particular whose media a
 * preview serves.
 *
 * A shared project's live preview (apps/web's `share-handlers.ts`) runs in
 * a sandbox named for its link, so the sandbox's name is no longer always
 * the account whose library `/media/` should read. The owner is then named
 * separately, and everything that names nobody keeps the old reading.
 */

const FILES = [{ path: 'index.html', content: '<img src="/media/a.png">' }];

describe('starting a preview', () => {
  it("serves the sandbox's own library when nobody else is named", () => {
    const parsed = parseStartRequest({ userId: 'user_1', files: FILES });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.mediaOwner, 'user_1');
    assert.equal(parsed.value.label, 'user_1');
  });

  it("serves the named owner's library for a shared project's sandbox", () => {
    const parsed = parseStartRequest({
      userId: 'shared-0123456789abcdef0123456789abcdef',
      label: 'shared-0123456789abcdef0123456789abcdef',
      files: FILES,
      mediaOwner: 'user_owner',
    });
    assert.ok(parsed.ok);
    assert.equal(
      parsed.value.userId,
      'shared-0123456789abcdef0123456789abcdef',
    );
    assert.equal(parsed.value.mediaOwner, 'user_owner');
  });

  it('refuses an owner that is not a name', () => {
    for (const mediaOwner of ['', 7, null]) {
      const parsed = parseStartRequest({
        userId: 'user_1',
        files: FILES,
        mediaOwner,
      });
      assert.equal(parsed.ok, false, String(mediaOwner));
    }
  });

  it('still refuses what it always refused', () => {
    assert.equal(parseStartRequest({ files: FILES }).ok, false);
    assert.equal(parseStartRequest({ userId: 'u', files: 'x' }).ok, false);
    assert.equal(
      parseStartRequest({ userId: 'u', files: [{ path: 1 }] }).ok,
      false,
    );
  });
});
