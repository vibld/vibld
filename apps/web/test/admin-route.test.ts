import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ADMIN_PATH, adminPageView, isAdminPath } from '../src/admin/route.ts';

/**
 * Which path is the admin page, and what it shows (#184).
 *
 * The third view is the one worth a test. `isAdmin` arrives from a fetch,
 * so every page load begins not knowing, and a shell that read that silence
 * as "no" would tell an admin opening `/admin` directly that their own page
 * does not exist, then replace it a moment later.
 */

describe('the admin path', () => {
  it('matches the path itself and the same path with a trailing slash', () => {
    assert.equal(isAdminPath(ADMIN_PATH), true);
    assert.equal(isAdminPath(`${ADMIN_PATH}/`), true);
  });

  it('matches nothing else', () => {
    for (const path of [
      '/',
      '/admin/credit',
      '/administrator',
      '/adminx',
      '/x/admin',
      '',
    ]) {
      assert.equal(
        isAdminPath(path),
        false,
        `${path || '(empty)'} was taken for the admin page`,
      );
    }
  });
});

describe('what the admin page shows', () => {
  it('waits while the answer is still unknown', () => {
    assert.equal(
      adminPageView(null),
      'checking',
      'an unanswered probe was read as a refusal, which tells an admin their own page does not exist',
    );
  });

  it('refuses a caller the probe said is not an admin', () => {
    assert.equal(adminPageView(false), 'denied');
  });

  it('shows the tools to an admin', () => {
    assert.equal(adminPageView(true), 'admin');
  });
});
