import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  RemoteModelProvider,
  detectGenerationMode,
  resetGenerationModeProbe,
} from '../src/generation/remote-provider.ts';

const PLAN = { summary: 'ok', files: [{ path: 'src/App.tsx', content: 'x' }] };

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('RemoteModelProvider', () => {
  it('posts the request and returns the plan', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ plan: PLAN }), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new RemoteModelProvider({
      fetchImpl,
      id: 'anthropic:test',
    });
    const plan = await provider.generate({ prompt: 'a landing page' });

    assert.deepEqual(plan, PLAN);
    const [url, init] = calls[0]!;
    assert.equal(url, '/api/plan');
    assert.equal(init?.method, 'POST');
    // Access uses a cookie; omitting credentials makes every call look
    // unauthenticated.
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(JSON.parse(String(init?.body)).prompt, 'a landing page');
  });

  it('surfaces the service error message rather than a bare status', async () => {
    const provider = new RemoteModelProvider({
      fetchImpl: jsonFetch(
        { error: 'The model declined this request (cyber)' },
        422,
      ),
    });
    await assert.rejects(
      () => provider.generate({ prompt: 'x' }),
      (error: unknown) => {
        assert.match((error as Error).message, /declined this request/);
        return true;
      },
    );
  });

  it('rejects a malformed success body instead of returning a broken plan', async () => {
    const provider = new RemoteModelProvider({
      fetchImpl: jsonFetch({ plan: { summary: 'no files' } }),
    });
    await assert.rejects(
      () => provider.generate({ prompt: 'x' }),
      /unexpected response/,
    );
  });
});

describe('detectGenerationMode', () => {
  beforeEach(() => resetGenerationModeProbe());

  it('reports model generation when the deployment says so', async () => {
    assert.equal(
      await detectGenerationMode(jsonFetch({ generation: 'model' })),
      'model',
    );
  });

  it('falls back to the fake when the endpoint is absent', async () => {
    const failing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    assert.equal(await detectGenerationMode(failing), 'fake');
  });

  it('falls back to the fake when generation is not configured', async () => {
    assert.equal(
      await detectGenerationMode(jsonFetch({ generation: 'fake' })),
      'fake',
    );
    resetGenerationModeProbe();
    assert.equal(
      await detectGenerationMode(jsonFetch({ error: 'nope' }, 403)),
      'fake',
    );
  });

  it('probes once per page load', async () => {
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ generation: 'model' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    await detectGenerationMode(counting);
    await detectGenerationMode(counting);
    assert.equal(calls, 1);
  });
});
