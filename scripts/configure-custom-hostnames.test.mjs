import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FALLBACK_ORIGIN, plan } from './configure-custom-hostnames.mjs';

describe('configuring the preview zone for custom domains (D189)', () => {
  it('adds the record and the fallback origin on a fresh zone', () => {
    assert.deepEqual(
      plan({ records: [], fallback: null }).map((step) => step.kind),
      ['record', 'fallback'],
    );
  });

  it('proxies a record that is DNS only', () => {
    const steps = plan({
      records: [
        { id: 'r1', type: 'AAAA', name: FALLBACK_ORIGIN, proxied: false },
      ],
      fallback: { origin: FALLBACK_ORIGIN, status: 'active' },
    });
    assert.deepEqual(steps, [
      {
        kind: 'proxy',
        id: 'r1',
        say: `Proxy the existing AAAA record ${FALLBACK_ORIGIN}`,
      },
    ]);
  });

  it('changes nothing on a zone that is ready', () => {
    assert.deepEqual(
      plan({
        records: [
          { id: 'r1', type: 'AAAA', name: FALLBACK_ORIGIN, proxied: true },
        ],
        fallback: { origin: FALLBACK_ORIGIN, status: 'active' },
      }),
      [],
    );
  });
});
