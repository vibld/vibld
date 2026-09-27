import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAuthorizedInternalCaller } from '../worker/internal-auth.ts';

function headersWith(authorization?: string): Headers {
  const headers = new Headers();
  if (authorization !== undefined) headers.set('Authorization', authorization);
  return headers;
}

describe('isAuthorizedInternalCaller', () => {
  it('accepts the exact configured secret as a bearer token', () => {
    assert.equal(
      isAuthorizedInternalCaller(headersWith('Bearer s3cr3t'), 's3cr3t'),
      true,
    );
  });

  it('refuses a missing Authorization header', () => {
    assert.equal(isAuthorizedInternalCaller(headersWith(), 's3cr3t'), false);
  });

  it('refuses the wrong secret', () => {
    assert.equal(
      isAuthorizedInternalCaller(headersWith('Bearer wrong'), 's3cr3t'),
      false,
    );
  });

  it('refuses a header without the Bearer scheme', () => {
    assert.equal(
      isAuthorizedInternalCaller(headersWith('s3cr3t'), 's3cr3t'),
      false,
    );
  });

  it('fails closed when no secret is configured, even with a matching header', () => {
    assert.equal(
      isAuthorizedInternalCaller(headersWith('Bearer undefined'), undefined),
      false,
    );
  });

  it('is case-sensitive and exact -- no trimming a near-miss into a match', () => {
    assert.equal(
      isAuthorizedInternalCaller(headersWith('Bearer S3CR3T'), 's3cr3t'),
      false,
    );
  });
});
