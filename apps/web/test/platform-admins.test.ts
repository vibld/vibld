import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isPlatformAdmin,
  parsePlatformAdmins,
} from '../worker/platform-admins.ts';

describe('parsePlatformAdmins', () => {
  it('returns an empty set for undefined or empty input', () => {
    assert.equal(parsePlatformAdmins(undefined).size, 0);
    assert.equal(parsePlatformAdmins('').size, 0);
  });

  it('splits on commas, trims whitespace and lowercases', () => {
    const admins = parsePlatformAdmins(
      ' Chris@Example.com, someone-else@example.com ,,third@example.com',
    );
    assert.deepEqual([...admins].sort(), [
      'chris@example.com',
      'someone-else@example.com',
      'third@example.com',
    ]);
  });

  it('drops empty entries from stray commas', () => {
    const admins = parsePlatformAdmins('a@example.com,,b@example.com,');
    assert.equal(admins.size, 2);
  });
});

describe('isPlatformAdmin', () => {
  const admins = parsePlatformAdmins('chris@example.com');

  it('grants when email is present, verified, and on the list', () => {
    assert.equal(
      isPlatformAdmin(
        { email: 'chris@example.com', emailVerified: true },
        admins,
      ),
      true,
    );
  });

  it('matches case-insensitively', () => {
    assert.equal(
      isPlatformAdmin(
        { email: 'Chris@Example.com', emailVerified: true },
        admins,
      ),
      true,
    );
  });

  it('denies when email is missing entirely', () => {
    assert.equal(isPlatformAdmin({ emailVerified: true }, admins), false);
  });

  it('denies when emailVerified is false', () => {
    assert.equal(
      isPlatformAdmin(
        { email: 'chris@example.com', emailVerified: false },
        admins,
      ),
      false,
    );
  });

  it('denies when emailVerified is absent -- missing verification must never default to verified', () => {
    assert.equal(
      isPlatformAdmin({ email: 'chris@example.com' }, admins),
      false,
    );
  });

  it('denies when the email is verified but not on the list', () => {
    assert.equal(
      isPlatformAdmin(
        { email: 'nobody@example.com', emailVerified: true },
        admins,
      ),
      false,
    );
  });

  it('denies everything against an empty admin set', () => {
    assert.equal(
      isPlatformAdmin(
        { email: 'chris@example.com', emailVerified: true },
        parsePlatformAdmins(undefined),
      ),
      false,
    );
  });
});
