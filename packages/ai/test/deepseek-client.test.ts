import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PlanProvider, DEFAULT_MAX_TOKENS } from '../src/plan-provider.ts';
import {
  JSON_MODE_INSTRUCTION,
  createDeepseekPlanClient,
  mapFinishReason,
  readCompletionStream,
  readJsonPlan,
} from '../src/deepseek-client.ts';
import { ProviderShapeError, ProviderTruncationError } from '../src/errors.ts';
import type { PlanUsage } from '../src/client.ts';

const PLAN = {
  summary: 'A navy landing page.',
  files: [
    { path: 'package.json', content: '{ "name": "demo" }' },
    { path: 'index.html', content: '<!doctype html>' },
    { path: 'src/main.tsx', content: 'export {};' },
    { path: 'src/App.tsx', content: 'export function App() { return null; }' },
    { path: 'src/styles.css', content: ':root { --navy: #0b1b3a; }' },
  ],
};

/** Build an SSE body, optionally split at arbitrary byte boundaries. */
function sse(frames: string[], chunkSize?: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(frames.join(''));
  const size = chunkSize ?? bytes.length;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) {
        controller.enqueue(bytes.slice(i, i + size));
      }
      controller.close();
    },
  });
}

function contentFrames(
  text: string,
  finish = 'stop',
  usage?: unknown,
): string[] {
  return [
    ...[...text].map(
      (ch) =>
        `data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n`,
    ),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n`,
    ...(usage ? [`data: ${JSON.stringify({ choices: [], usage })}\n`] : []),
    'data: [DONE]\n',
  ];
}

function fetchReturning(
  body: ReadableStream<Uint8Array>,
  status = 200,
): { impl: typeof fetch; calls: RequestInit[] } {
  const calls: RequestInit[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    calls.push(init);
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('mapFinishReason', () => {
  it('translates a hit output ceiling into the truncation vocabulary', () => {
    // This mapping is what lets ProviderTruncationError fire. Without it a
    // truncated plan surfaces as an unreadable JSON parse failure, which is
    // the exact confusion the Anthropic path was already fixed for.
    assert.equal(mapFinishReason('length'), 'max_tokens');
  });

  it('translates the ordinary and filtered endings', () => {
    assert.equal(mapFinishReason('stop'), 'end_turn');
    assert.equal(mapFinishReason('content_filter'), 'refusal');
  });

  it('passes an unknown reason through rather than inventing one', () => {
    assert.equal(mapFinishReason('tool_calls'), 'tool_calls');
    assert.equal(mapFinishReason(null), null);
    assert.equal(mapFinishReason(undefined), null);
  });
});

describe('readJsonPlan', () => {
  it('returns null rather than throwing on truncated json', () => {
    // The caller knows the stop reason and names it; throwing here would
    // report truncation as a parse bug.
    assert.equal(readJsonPlan('{"summary":"half a fi'), null);
  });

  it('returns null for the documented empty reply', () => {
    assert.equal(readJsonPlan(''), null);
    assert.equal(readJsonPlan('   \n '), null);
  });
});

describe('readCompletionStream', () => {
  it('reassembles content split across arbitrary chunk boundaries', async () => {
    // One byte at a time: a frame does not arrive whole, and a parser that
    // assumed it did would fail only against a real server.
    const result = await readCompletionStream(sse(contentFrames('hello'), 1));
    assert.equal(result.text, 'hello');
    assert.equal(result.finishReason, 'stop');
  });

  it('reads usage from the final chunk, which carries no choices', async () => {
    const result = await readCompletionStream(
      sse(
        contentFrames('hi', 'stop', {
          prompt_tokens: 120,
          completion_tokens: 3400,
          prompt_cache_hit_tokens: 64,
        }),
      ),
    );
    assert.equal(result.usage?.completion_tokens, 3400);
    assert.equal(result.usage?.prompt_cache_hit_tokens, 64);
  });

  it('reports progress as the text arrives', async () => {
    const seen: number[] = [];
    await readCompletionStream(sse(contentFrames('abcd')), (n) => seen.push(n));
    assert.deepEqual(seen, [1, 2, 3, 4]);
  });

  it('rejects a malformed chunk instead of silently losing content', async () => {
    await assert.rejects(
      () => readCompletionStream(sse(['data: {not json\n'])),
      /malformed stream chunk/,
    );
  });

  it('ignores the [DONE] sentinel and any non-data line', async () => {
    const result = await readCompletionStream(
      sse([': keepalive\n', '\n', ...contentFrames('ok')]),
    );
    assert.equal(result.text, 'ok');
  });
});

describe('createDeepseekPlanClient', () => {
  it('asks for json mode and says "json" in the prompt, as the API requires', async () => {
    // DeepSeek's JSON mode does not engage unless the word appears in the
    // prompt, and it enforces no schema, so the shape is spelled out too.
    const { impl, calls } = fetchReturning(
      sse(contentFrames(JSON.stringify(PLAN))),
    );
    const client = createDeepseekPlanClient({ apiKey: 'k', fetchImpl: impl });
    await client.createPlan({
      system: 'SYSTEM',
      prompt: 'a landing page',
      model: 'deepseek-flash',
      maxTokens: 64_000,
      effort: 'high',
    });

    const sent = JSON.parse(String(calls[0]!.body));
    assert.deepEqual(sent.response_format, { type: 'json_object' });
    assert.equal(sent.stream, true);
    assert.match(sent.messages[0].content, /json/);
    assert.ok(sent.messages[0].content.includes(JSON_MODE_INSTRUCTION));
    assert.ok(sent.messages[0].content.startsWith('SYSTEM'));
    assert.equal(sent.messages[1].content, 'a landing page');
  });

  it('sends the key as a bearer token and never in the URL', async () => {
    const calls: string[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push(url);
      assert.equal(
        (init.headers as Record<string, string>).authorization,
        'Bearer sk-secret',
      );
      return new Response(sse(contentFrames('{}')), { status: 200 });
    }) as unknown as typeof fetch;

    await createDeepseekPlanClient({
      apiKey: 'sk-secret',
      fetchImpl: impl,
    }).createPlan({
      system: 's',
      prompt: 'p',
      model: 'deepseek-flash',
      maxTokens: 100,
      effort: 'high',
    });
    assert.equal(calls[0], 'https://api.deepseek.com/chat/completions');
    assert.equal(calls[0]!.includes('sk-secret'), false);
  });

  it('maps usage, including cache hits', async () => {
    const { impl } = fetchReturning(
      sse(
        contentFrames(JSON.stringify(PLAN), 'stop', {
          prompt_tokens: 900,
          completion_tokens: 12_000,
          prompt_cache_hit_tokens: 512,
        }),
      ),
    );
    const completion = await createDeepseekPlanClient({
      apiKey: 'k',
      fetchImpl: impl,
    }).createPlan({
      system: 's',
      prompt: 'p',
      model: 'deepseek-flash',
      maxTokens: 64_000,
      effort: 'high',
    });

    assert.deepEqual(completion.usage, {
      inputTokens: 900,
      outputTokens: 12_000,
      cacheReadInputTokens: 512,
    });
    assert.equal(completion.stopReason, 'end_turn');
    assert.deepEqual(completion.plan, PLAN);
  });

  it('estimates usage when the stream omits it, erring high', async () => {
    // A budget that under-reports is worse than one that over-reports, which
    // is the same rule the spend ceiling already follows.
    const { impl } = fetchReturning(sse(contentFrames('x'.repeat(400))));
    const completion = await createDeepseekPlanClient({
      apiKey: 'k',
      fetchImpl: impl,
    }).createPlan({
      system: 'a'.repeat(200),
      prompt: 'b'.repeat(200),
      model: 'deepseek-flash',
      maxTokens: 64_000,
      effort: 'high',
    });
    assert.equal(completion.usage.outputTokens, 100);
    assert.equal(completion.usage.inputTokens, 100);
  });

  it('refuses to call out without a key, rather than sending an empty header', async () => {
    let called = false;
    const impl = (async () => {
      called = true;
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;
    await assert.rejects(
      () =>
        createDeepseekPlanClient({ apiKey: '', fetchImpl: impl }).createPlan({
          system: 's',
          prompt: 'p',
          model: 'deepseek-flash',
          maxTokens: 10,
          effort: 'high',
        }),
      /DEEPSEEK_API_KEY is not set/,
    );
    assert.equal(called, false);
  });

  it('never puts the key in the error when the service rejects the call', async () => {
    const impl = (async () =>
      new Response('bad things', { status: 402 })) as unknown as typeof fetch;
    await assert.rejects(
      () =>
        createDeepseekPlanClient({
          apiKey: 'sk-secret',
          fetchImpl: impl,
        }).createPlan({
          system: 's',
          prompt: 'p',
          model: 'deepseek-flash',
          maxTokens: 10,
          effort: 'high',
        }),
      (error: Error) => {
        assert.match(error.message, /402/);
        assert.equal(error.message.includes('sk-secret'), false);
        return true;
      },
    );
  });
});

describe('the provider above, driven by DeepSeek', () => {
  function clientReturning(frames: string[]) {
    const { impl } = fetchReturning(sse(frames));
    return createDeepseekPlanClient({ apiKey: 'k', fetchImpl: impl });
  }

  it('produces a validated plan end to end', async () => {
    const plan = await new PlanProvider(
      clientReturning(contentFrames(JSON.stringify(PLAN))),
      { model: 'deepseek-flash' },
    ).generate({ prompt: 'a landing page' });
    assert.deepEqual(plan, PLAN);
  });

  it('names a hit output ceiling as truncation', async () => {
    // The whole point of the finish_reason mapping.
    await assert.rejects(
      () =>
        new PlanProvider(
          clientReturning(contentFrames('{"summary":"cut off mid', 'length')),
          { model: 'deepseek-flash', maxTokens: DEFAULT_MAX_TOKENS },
        ).generate({ prompt: 'x' }),
      ProviderTruncationError,
    );
  });

  it('names an off-schema reply, which this provider cannot prevent', async () => {
    // DeepSeek offers JSON mode, not JSON schema, so an off-shape reply is a
    // real possibility rather than a theoretical one. It must be reported,
    // never accepted as a project.
    await assert.rejects(
      () =>
        new PlanProvider(
          clientReturning(contentFrames('{"summary":"no files at all"}')),
          { model: 'deepseek-flash' },
        ).generate({ prompt: 'x' }),
      ProviderShapeError,
    );
  });

  it('names the documented empty reply rather than crashing', async () => {
    await assert.rejects(
      () =>
        new PlanProvider(clientReturning(contentFrames('')), {
          model: 'deepseek-flash',
        }).generate({ prompt: 'x' }),
      ProviderShapeError,
    );
  });

  it('reports usage even for a failed run', async () => {
    // A refusal or a truncation still spends tokens.
    let usage: PlanUsage | undefined;
    await assert.rejects(() =>
      new PlanProvider(
        clientReturning(
          contentFrames('{"broken', 'length', {
            prompt_tokens: 50,
            completion_tokens: 64_000,
          }),
        ),
        {
          model: 'deepseek-flash',
          onUsage: (reported) => {
            usage = reported;
          },
        },
      ).generate({ prompt: 'x' }),
    );
    assert.equal(usage?.outputTokens, 64_000);
  });
});
