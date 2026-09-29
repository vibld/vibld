import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_RETRIES,
  canResendWrite,
  isEdgeRefusal,
  isRetryableRead,
  rateLimitDelayMs,
  withRateLimitRetry,
} from '../src/net/rate-limit-retry.ts';

const ORIGIN = 'https://app.vibld.com';

function scripted(
  statuses: number[],
  retryAfter: string | null = '10',
  contentType = 'text/html; charset=UTF-8',
) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    return new Response(status === 429 ? '<html>' : '{}', {
      status,
      headers: {
        'content-type': status === 429 ? contentType : 'application/json',
        ...(retryAfter ? { 'retry-after': retryAfter } : {}),
      },
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

  it('sends a write again only when the edge refused it', async () => {
    const edge = scripted([429, 201]);
    const retrying = withRateLimitRetry(edge.fetchImpl, {
      origin: ORIGIN,
      sleep: async () => {},
    });
    const created = await retrying('/api/projects', {
      method: 'POST',
      body: '{}',
    });
    assert.equal(created.status, 201);
    assert.equal(edge.calls.length, 2);

    const worker = scripted([429], null, 'application/json; charset=utf-8');
    const refused = await withRateLimitRetry(worker.fetchImpl, {
      origin: ORIGIN,
      sleep: async () => {},
    })('/api/plan', { method: 'POST', body: '{}' });
    assert.equal(refused.status, 429);
    assert.equal(worker.calls.length, 1);
  });

  it('never resends a body that can only be read once', () => {
    assert.equal(
      canResendWrite('/api/x', { method: 'POST', body: '{}' }),
      true,
    );
    assert.equal(canResendWrite('/api/x', { method: 'POST' }), true);
    assert.equal(
      canResendWrite('/api/x', {
        method: 'POST',
        body: new ReadableStream(),
      }),
      false,
    );
    assert.equal(
      canResendWrite(new Request(`${ORIGIN}/api/x`, { method: 'POST' }), {}),
      false,
    );
  });

  it('tells the edge page from the Worker refusal', () => {
    assert.equal(
      isEdgeRefusal(
        new Response('<html>', {
          status: 429,
          headers: { 'content-type': 'text/html' },
        }),
      ),
      true,
    );
    assert.equal(
      isEdgeRefusal(
        new Response('{}', {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
      ),
      false,
    );
  });
});
