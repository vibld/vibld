import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  RemoteModelProvider,
  detectGenerationMode,
  readPlanEvents,
  resetGenerationModeProbe,
} from '../src/generation/remote-provider.ts';

const PLAN = { summary: 'ok', files: [{ path: 'src/App.tsx', content: 'x' }] };

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

/** Build an SSE response body, optionally split across arbitrary chunks. */
function sseResponse(
  frames: string[],
  chunkSize?: number,
  status = 200,
): Response {
  const text = frames.join('');
  const bytes = new TextEncoder().encode(text);
  const size = chunkSize ?? bytes.length;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < bytes.length; index += size) {
        controller.enqueue(bytes.slice(index, index + size));
      }
      controller.close();
    },
  });
  return new Response(stream, { status });
}

const PLAN_FRAME = `event: plan\ndata: ${JSON.stringify({ providerId: 'anthropic:x', plan: PLAN })}\n\n`;

describe('readPlanEvents', () => {
  it('skips keepalive comments and yields real events', async () => {
    const body = sseResponse([
      ': keepalive\n\n',
      ': keepalive\n\n',
      PLAN_FRAME,
    ]).body!;
    const events = [];
    for await (const event of readPlanEvents(body)) events.push(event);

    assert.equal(events.length, 1);
    assert.equal(events[0]!.event, 'plan');
  });

  it('reassembles frames split across arbitrary chunk boundaries', async () => {
    // One byte at a time: the parser must not assume a frame arrives whole.
    const body = sseResponse([': keepalive\n\n', PLAN_FRAME], 1).body!;
    const events = [];
    for await (const event of readPlanEvents(body)) events.push(event);

    assert.equal(events.length, 1);
    assert.deepEqual((events[0]!.data as { plan: unknown }).plan, PLAN);
  });

  it('rejects a malformed data payload', async () => {
    const body = sseResponse(['event: plan\ndata: {not json\n\n']).body!;
    await assert.rejects(async () => {
      for await (const _ of readPlanEvents(body)) void _;
    }, /malformed event/);
  });
});

describe('RemoteModelProvider', () => {
  it('posts the request and returns the streamed plan', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return sseResponse([': keepalive\n\n', PLAN_FRAME]);
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

  it('surfaces a streamed error event', async () => {
    const frame = `event: error\ndata: ${JSON.stringify({ error: 'The model declined this request (cyber)' })}\n\n`;
    const provider = new RemoteModelProvider({
      fetchImpl: (async () =>
        sseResponse([': keepalive\n\n', frame])) as unknown as typeof fetch,
    });
    await assert.rejects(
      () => provider.generate({ prompt: 'x' }),
      /declined this request/,
    );
  });

  it('surfaces an HTTP error body', async () => {
    const provider = new RemoteModelProvider({
      fetchImpl: jsonFetch(
        { error: 'This endpoint requires Cloudflare Access sign-in.' },
        401,
      ),
    });
    await assert.rejects(
      () => provider.generate({ prompt: 'x' }),
      /Cloudflare Access sign-in/,
    );
  });

  it('names a connection that closes before a result, rather than failing opaquely', async () => {
    const provider = new RemoteModelProvider({
      fetchImpl: (async () =>
        sseResponse([
          ': keepalive\n\n',
          ': keepalive\n\n',
        ])) as unknown as typeof fetch,
    });
    await assert.rejects(
      () => provider.generate({ prompt: 'x' }),
      /connection closed before generation finished/,
    );
  });

  it('rejects a malformed plan payload instead of returning a broken plan', async () => {
    const frame = `event: plan\ndata: ${JSON.stringify({ plan: { summary: 'no files' } })}\n\n`;
    const provider = new RemoteModelProvider({
      fetchImpl: (async () => sseResponse([frame])) as unknown as typeof fetch,
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
