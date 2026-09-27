import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkProviderBalances,
  fetchDeepseekBalance,
} from '../worker/provider-balance.ts';

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

function recordingFetch(
  responses: Record<string, { body: unknown; status?: number }>,
): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    const match = responses[url];
    if (!match) throw new Error(`unexpected fetch to ${url}`);
    return new Response(JSON.stringify(match.body), {
      status: match.status ?? 200,
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('fetchDeepseekBalance', () => {
  it('parses a successful response', async () => {
    const fetchImpl = jsonFetch({
      is_available: true,
      balance_infos: [
        { currency: 'USD', total_balance: '42.50', granted_balance: '0' },
      ],
    });
    const balance = await fetchDeepseekBalance('key', fetchImpl);
    assert.deepEqual(balance, { currency: 'USD', totalBalance: 42.5 });
  });

  it('returns null rather than throwing on a non-success response', async () => {
    const fetchImpl = jsonFetch({ error: 'unauthorized' }, 401);
    assert.equal(await fetchDeepseekBalance('bad-key', fetchImpl), null);
  });

  it('returns null on an unparseable body', async () => {
    const fetchImpl = (async () =>
      new Response('not json', { status: 200 })) as unknown as typeof fetch;
    assert.equal(await fetchDeepseekBalance('key', fetchImpl), null);
  });

  it('returns null when the network call itself throws', async () => {
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    assert.equal(await fetchDeepseekBalance('key', fetchImpl), null);
  });
});

describe('checkProviderBalances', () => {
  it('checks nothing when no provider key is configured', async () => {
    const { fetchImpl, calls } = recordingFetch({});
    const result = await checkProviderBalances({}, fetchImpl);
    assert.deepEqual(result, { checked: [], alerted: [] });
    assert.deepEqual(calls, []);
  });

  it('checks DeepSeek but sends no alert above the threshold', async () => {
    const { fetchImpl } = recordingFetch({
      'https://api.deepseek.com/user/balance': {
        body: { balance_infos: [{ currency: 'USD', total_balance: '100' }] },
      },
    });
    const result = await checkProviderBalances(
      { DEEPSEEK_API_KEY: 'key', RESEND_API_KEY: 'resend-key' },
      fetchImpl,
    );
    assert.deepEqual(result, { checked: ['deepseek'], alerted: [] });
  });

  it('alerts through Resend when the balance is below the threshold', async () => {
    const { fetchImpl, calls } = recordingFetch({
      'https://api.deepseek.com/user/balance': {
        body: { balance_infos: [{ currency: 'USD', total_balance: '2.00' }] },
      },
      'https://api.resend.com/emails': { body: { id: 'email_1' } },
    });
    const result = await checkProviderBalances(
      {
        DEEPSEEK_API_KEY: 'key',
        RESEND_API_KEY: 'resend-key',
        VIBLD_DEEPSEEK_BALANCE_ALERT_USD: '10',
      },
      fetchImpl,
    );
    assert.deepEqual(result, { checked: ['deepseek'], alerted: ['deepseek'] });
    assert.deepEqual(calls, [
      'https://api.deepseek.com/user/balance',
      'https://api.resend.com/emails',
    ]);
  });

  it('does not report an alert as sent when RESEND_API_KEY is unset', async () => {
    // The balance is genuinely low, but there is nowhere configured to send
    // the email -- this must not report success it did not achieve.
    const { fetchImpl } = recordingFetch({
      'https://api.deepseek.com/user/balance': {
        body: { balance_infos: [{ currency: 'USD', total_balance: '2.00' }] },
      },
    });
    const result = await checkProviderBalances(
      { DEEPSEEK_API_KEY: 'key' },
      fetchImpl,
    );
    assert.deepEqual(result, { checked: ['deepseek'], alerted: [] });
  });

  it('never throws when the balance fetch itself fails', async () => {
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const result = await checkProviderBalances(
      { DEEPSEEK_API_KEY: 'key' },
      fetchImpl,
    );
    assert.deepEqual(result, { checked: ['deepseek'], alerted: [] });
  });
});
