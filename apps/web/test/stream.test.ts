import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_KEEPALIVE_MS,
  KEEPALIVE_COMMENT,
  encodeEvent,
  parseKeepaliveMs,
} from '../worker/stream.ts';

describe('stream framing', () => {
  it('encodes an event as a complete SSE frame', () => {
    assert.equal(
      encodeEvent('plan', { a: 1 }),
      'event: plan\ndata: {"a":1}\n\n',
    );
  });

  it('uses a comment for keepalives so clients ignore them', () => {
    assert.ok(KEEPALIVE_COMMENT.startsWith(':'));
    assert.ok(KEEPALIVE_COMMENT.endsWith('\n\n'));
  });
});

describe('keepalive interval configuration', () => {
  it('is configurable rather than hardcoded', () => {
    assert.equal(parseKeepaliveMs('5000'), 5000);
    assert.equal(parseKeepaliveMs('30000'), 30000);
  });

  it('falls back to the documented default when unset or unusable', () => {
    for (const bad of [
      undefined,
      '',
      'soon',
      '0',
      '-1',
      '999',
      '120000',
      'NaN',
    ]) {
      assert.equal(parseKeepaliveMs(bad), DEFAULT_KEEPALIVE_MS);
    }
  });

  it('keeps the default inside common browser and proxy idle windows', () => {
    assert.ok(DEFAULT_KEEPALIVE_MS >= 1000 && DEFAULT_KEEPALIVE_MS <= 30_000);
  });
});
