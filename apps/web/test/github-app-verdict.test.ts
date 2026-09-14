import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { appVerdict, blocking } from '../scripts/github-app-verdict.ts';

/**
 * Whether the App can actually do what the push path asks of it.
 *
 * Every rule here came from a review finding on the check itself, which is
 * the reason they are run rather than read: a script cannot be imported, so
 * a rule written inside one is only ever asserted by eye.
 */

const WRITE = { contents: 'write', pull_requests: 'write', metadata: 'read' };

describe('what the App itself is configured to hold', () => {
  it('passes the permissions this feature needs', () => {
    const verdict = appVerdict(WRITE, []);
    assert.deepEqual(verdict.missing, []);
    assert.deepEqual(verdict.extra, []);
    assert.equal(blocking(verdict), false);
  });

  it('names a permission that is read where write is needed', () => {
    const verdict = appVerdict({ ...WRITE, contents: 'read' }, []);
    assert.deepEqual(verdict.missing, [
      { name: 'contents', level: 'write', has: 'read' },
    ]);
    assert.equal(blocking(verdict), true);
  });

  it('names one that is absent rather than merely wrong', () => {
    const { pull_requests: _gone, ...without } = WRITE;
    const verdict = appVerdict(without, []);
    assert.deepEqual(verdict.missing, [
      { name: 'pull_requests', level: 'write', has: 'absent' },
    ]);
  });

  it('refuses a scope this feature does not use', () => {
    // The finding: contents and pull_requests being right made the check
    // pass while an unrelated permission rode along. An App key is not a
    // token; it reaches every installation at once, so an extra scope is
    // blast radius rather than untidiness.
    const verdict = appVerdict({ ...WRITE, members: 'read' }, []);
    assert.deepEqual(verdict.extra, ['members']);
    assert.equal(blocking(verdict), true);
  });

  it('allows the one permission GitHub grants whether or not you ask', () => {
    // `metadata` cannot be declined, so treating it as an extra scope would
    // fail every correctly configured App there is.
    assert.deepEqual(appVerdict(WRITE, []).extra, []);
  });
});

describe('what each installation has actually accepted', () => {
  // The finding: `GET /app` describes the App's configuration, which is not
  // what any installation will grant. Raising a permission takes effect only
  // when each owner accepts, and until then that installation refuses the
  // scopes the push asks for. So the App-level check alone passes in exactly
  // the state it exists to catch.
  it('names an installation still on the old permissions', () => {
    const verdict = appVerdict(WRITE, [
      { id: 1, account: { login: 'acme' }, permissions: WRITE },
      {
        id: 2,
        account: { login: 'globex' },
        permissions: { ...WRITE, contents: 'read' },
      },
    ]);
    assert.deepEqual(verdict.lagging, [
      { account: 'globex', short: ['contents'] },
    ]);
  });

  it('says nothing when every installation is current', () => {
    const verdict = appVerdict(WRITE, [
      { id: 1, account: { login: 'acme' }, permissions: WRITE },
    ]);
    assert.deepEqual(verdict.lagging, []);
  });

  it('does not block the deploy on somebody else accepting', () => {
    // Refusing to ship anything until another account clicks a button would
    // be worse than the thing it guards against, so this is loud and not
    // fatal.
    const verdict = appVerdict(WRITE, [
      {
        id: 2,
        account: { login: 'globex' },
        permissions: { contents: 'read' },
      },
    ]);
    assert.equal(verdict.lagging.length, 1);
    assert.equal(blocking(verdict), false);
  });

  it('falls back to the id when an installation has no account login', () => {
    const verdict = appVerdict(WRITE, [{ id: 7, permissions: {} }]);
    assert.equal(verdict.lagging[0]?.account, 'installation 7');
  });

  it('treats installations it could not read as nothing to report', () => {
    assert.deepEqual(appVerdict(WRITE, null).lagging, []);
  });
});
