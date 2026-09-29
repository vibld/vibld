import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_RETRIES,
  isRetryableRead,
  rateLimitDelayMs,
  withRateLimitRetry,
} from '../src/net/rate-limit-retry.ts';

const ORIGIN = 'https://app.vibld.com';

function scripted(statuses: number[], retryAfter: string | null = '10') {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    return new Response(status === 429 ? '<html>' : '{}', {
      status,
      headers: retryAfter ? { 'retry-after': retryAfter } : {},
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('retrying an API read the edge rate limit refused (D68)', () => {
  it('waits what Retry-After asks, or a doubling second, at most ten', () => {
    assert.equal(rateLimitDelayMs('10', 0), 10_000);
    assert.equal(rateLimitDelayMs('0', 0), 1000);
    assert.equal(rateLimitDelayMs(null, 2), 4000);
    assert.equal(rateLimitDelayMs('120', 0), 10_000);
  });

  it('retries only GET and HEAD to this origin under /api/', () => {
    assert.equal(isRetryableRead('/api/projects', undefined, ORIGIN), true);
    assert.equal(
      isRetryableRead('/api/projects', { method: 'HEAD' }, ORIGIN),
      true,
    );
    assert.equal(
      isRetryableRead('/api/projects', { method: 'POST' }, ORIGIN),
      false,
    );
    assert.equal(isRetryableRead('/assets/app.js', undefined, ORIGIN), false);
    assert.equal(
      isRetryableRead('https://clerk.vibld.com/api/x', undefined, ORIGIN),
      false,
    );
  });

  it('waits out a 429 and returns the answer that follows', async () => {
    const { calls, fetchImpl } = scripted([429, 429, 200]);
    const waits: number[] = [];
    const retrying = withRateLimitRetry(fetchImpl, {
      origin: ORIGIN,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    const response = await retrying('/api/projects');
    assert.equal(response.status, 200);
    assert.equal(calls.length, 3);
    assert.deepEqual(waits, [10_000, 10_000]);
  });

  it('gives up after three retries and hands back the 429', async () => {
    const { calls, fetchImpl } = scripted([429]);
    const retrying = withRateLimitRetry(fetchImpl, {
      origin: ORIGIN,
      sleep: async () => {},
    });
    const response = await retrying('/api/config');
    assert.equal(response.status, 429);
    assert.equal(calls.length, MAX_RETRIES + 1);
  });

  it('never sends a write twice', async () => {
    const { calls, fetchImpl } = scripted([429]);
    const retrying = withRateLimitRetry(fetchImpl, {
      origin: ORIGIN,
      sleep: async () => {},
    });
    const response = await retrying('/api/projects', { method: 'POST' });
    assert.equal(response.status, 429);
    assert.equal(calls.length, 1);
  });
});
