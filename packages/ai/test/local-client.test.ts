import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LOCAL_MODEL_ID,
  LocalContextError,
  createLocalPlanClient,
  localModelSettings,
} from '../src/local-client.ts';
import { ProviderError } from '../src/errors.ts';
import type { PlanRequest } from '../src/client.ts';
import {
  configuredProviders,
  createPlanClient,
  providerForRequest,
  resolveModel,
  selectProvider,
} from '../src/select-client.ts';
import { availableModels, findModel } from '../src/model-catalogue.ts';
import { BoundedPlanProvider, withLocalAdvice } from '../src/bounded-build.ts';

/** A model on the owner's own machine (D124, D138). */

const SETTINGS = {
  baseUrl: 'http://localhost:11434/v1',
  model: 'qwen2.5-coder:7b',
};

const LOCAL_ENV = {
  VIBLD_LOCAL_BASE_URL: 'http://localhost:11434/v1/',
  VIBLD_LOCAL_MODEL: 'qwen2.5-coder:7b',
};

function sse(frames: string[]): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(frames.join(''));
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** A reply the way Ollama streams one: content, finish, usage, done. */
function reply(text: string, usage?: unknown, finish = 'stop'): string[] {
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`,
    ...(usage ? [`data: ${JSON.stringify({ choices: [], usage })}\n\n`] : []),
    'data: [DONE]\n\n',
  ];
}

interface Sent {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function server(answers: (() => Response)[]): {
  impl: typeof fetch;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    sent.push({
      url,
      init,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    return next();
  }) as unknown as typeof fetch;
  return { impl, sent };
}

function request(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    system: 'You build websites.',
    prompt: 'A bakery.',
    model: LOCAL_MODEL_ID,
    maxTokens: 16_384,
    effort: 'high',
    ...overrides,
  };
}

const GOOD = '{"summary":"A bakery.","files":[]}';

describe('the local model’s settings', () => {
  it('needs both an address and a model name', () => {
    assert.equal(localModelSettings({}), null);
    assert.equal(
      localModelSettings({ VIBLD_LOCAL_BASE_URL: 'http://localhost:1234/v1' }),
      null,
    );
    assert.equal(localModelSettings({ VIBLD_LOCAL_MODEL: 'llama3.3' }), null);
    assert.equal(
      localModelSettings({
        VIBLD_LOCAL_BASE_URL: '  ',
        VIBLD_LOCAL_MODEL: 'llama3.3',
      }),
      null,
    );
  });

  it('drops a trailing slash, and keeps a key only when there is one', () => {
    assert.deepEqual(localModelSettings(LOCAL_ENV), SETTINGS);
    assert.deepEqual(
      localModelSettings({ ...LOCAL_ENV, VIBLD_LOCAL_API_KEY: ' secret ' }),
      { ...SETTINGS, apiKey: 'secret' },
    );
  });
});

describe('choosing the local model', () => {
  it('counts as configured only with both settings', () => {
    assert.equal(configuredProviders(LOCAL_ENV).local, true);
    assert.equal(
      configuredProviders({ VIBLD_LOCAL_MODEL: 'llama3.3' }).local,
      false,
    );
  });

  it('is what a copy with nothing else builds with', () => {
    assert.equal(selectProvider(LOCAL_ENV), 'local');
    assert.equal(resolveModel(LOCAL_ENV), LOCAL_MODEL_ID);
    assert.equal(
      selectProvider({ ...LOCAL_ENV, VIBLD_PROVIDER: 'local' }),
      'local',
    );
  });

  it('does not take over from a key unless it is chosen', () => {
    assert.equal(
      selectProvider({ ...LOCAL_ENV, ANTHROPIC_API_KEY: 'a' }),
      'anthropic',
    );
    assert.equal(
      selectProvider({
        ...LOCAL_ENV,
        OPENAI_API_KEY: 'o',
        VIBLD_PROVIDER: 'local',
      }),
      'local',
    );
  });

  it('is one catalog entry, offered only where it is configured, and free', () => {
    const local = findModel(LOCAL_MODEL_ID);
    assert.ok(local);
    assert.equal(local.provider, 'local');
    assert.equal(local.inputMicroUsd, 0);
    assert.equal(local.outputMicroUsd, 0);
    assert.equal(providerForRequest(LOCAL_ENV, LOCAL_MODEL_ID), 'local');
    assert.deepEqual(
      availableModels(configuredProviders(LOCAL_ENV)).map((m) => m.id),
      [LOCAL_MODEL_ID],
    );
    assert.ok(
      !availableModels(configuredProviders({ OPENAI_API_KEY: 'o' })).some(
        (m) => m.id === LOCAL_MODEL_ID,
      ),
    );
  });

  it('refuses to make a client with nowhere to send it', () => {
    assert.throws(
      () => createPlanClient({ VIBLD_PROVIDER: 'local' }, LOCAL_MODEL_ID),
      /VIBLD_LOCAL_BASE_URL and VIBLD_LOCAL_MODEL/,
    );
    assert.equal(createPlanClient(LOCAL_ENV, LOCAL_MODEL_ID).id, 'local');
  });
});

describe('createLocalPlanClient', () => {
  it('sends the owner’s model name, JSON mode, and nothing a local server refuses', async () => {
    const { impl, sent } = server([
      () =>
        new Response(
          sse(reply(GOOD, { prompt_tokens: 400, completion_tokens: 9 })),
        ),
    ]);
    const client = createLocalPlanClient({ ...SETTINGS, fetchImpl: impl });
    const completion = await client.createPlan(request());

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.url, 'http://localhost:11434/v1/chat/completions');
    const body = sent[0]?.body ?? {};
    assert.equal(body.model, 'qwen2.5-coder:7b');
    assert.equal(body.max_tokens, 16_384);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    // Ollama refuses the whole request when a model that does not think is
    // sent this, which is most local models.
    assert.equal('reasoning_effort' in body, false);
    const headers = sent[0]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, undefined);

    assert.deepEqual(completion.plan, { summary: 'A bakery.', files: [] });
    assert.equal(completion.stopReason, 'end_turn');
    assert.deepEqual(completion.usage, {
      inputTokens: 400,
      outputTokens: 9,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
    });
  });

  it('sends a key only for a server started with one', async () => {
    const { impl, sent } = server([() => new Response(sse(reply(GOOD)))]);
    const client = createLocalPlanClient({
      ...SETTINGS,
      apiKey: 'k',
      fetchImpl: impl,
    });
    await client.createPlan(request());
    const headers = sent[0]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, 'Bearer k');
  });

  it('asks again without JSON mode when the server refuses it, and remembers', async () => {
    const { impl, sent } = server([
      () =>
        new Response(
          JSON.stringify({
            error: "'response_format.type' must be 'json_schema'",
          }),
          { status: 400 },
        ),
      () => new Response(sse(reply('```json\n' + GOOD + '\n```'))),
      () => new Response(sse(reply(GOOD))),
    ]);
    const client = createLocalPlanClient({ ...SETTINGS, fetchImpl: impl });
    const first = await client.createPlan(request());
    assert.deepEqual(first.plan, { summary: 'A bakery.', files: [] });
    await client.createPlan(request());
    assert.equal(sent.length, 3);
    assert.ok('response_format' in (sent[0]?.body ?? {}));
    assert.equal('response_format' in (sent[1]?.body ?? {}), false);
    assert.equal('response_format' in (sent[2]?.body ?? {}), false);
  });

  it('says the server cannot be reached, naming the setting and not the address', async () => {
    const impl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const client = createLocalPlanClient({ ...SETTINGS, fetchImpl: impl });
    await assert.rejects(client.createPlan(request()), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.match(error.message, /VIBLD_LOCAL_BASE_URL/);
      assert.match(error.message, /running/);
      assert.doesNotMatch(error.message, /localhost|11434/);
      return true;
    });
  });

  it('says a wait that ran out is a wait, not a missing server', async () => {
    // What Node's fetch throws after five minutes with no response headers.
    const impl = (async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('Headers Timeout Error'), {
          name: 'HeadersTimeoutError',
          code: 'UND_ERR_HEADERS_TIMEOUT',
        }),
      });
    }) as unknown as typeof fetch;
    const client = createLocalPlanClient({ ...SETTINGS, fetchImpl: impl });
    await assert.rejects(client.createPlan(request()), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.match(error.message, /took too long to start answering/);
      assert.match(error.message, /GPU/);
      return true;
    });
  });

  it('lets a cancellation through as it was', async () => {
    const controller = new AbortController();
    controller.abort();
    const impl = (async () => {
      throw new DOMException('aborted', 'AbortError');
    }) as unknown as typeof fetch;
    const client = createLocalPlanClient({ ...SETTINGS, fetchImpl: impl });
    await assert.rejects(
      client.createPlan(request({ signal: controller.signal })),
      (error: unknown) => !(error instanceof ProviderError),
    );
  });

  it('says which model to download when the server has none of that name', async () => {
    // Ollama's own answer, 2026-10-01.
    const { impl } = server([
      () =>
        new Response(
          JSON.stringify({
            error: { message: "model 'qwen2.5-coder:7b' not found" },
          }),
          { status: 404 },
        ),
    ]);
    const client = createLocalPlanClient({ ...SETTINGS, fetchImpl: impl });
    await assert.rejects(client.createPlan(request()), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.match(error.message, /no model named "qwen2\.5-coder:7b"/);
      assert.match(error.message, /ollama pull qwen2\.5-coder:7b/);
      return true;
    });
  });

  it('asks for the key when the server wants one', async () => {
    const { impl } = server([() => new Response('', { status: 401 })]);
    const client = createLocalPlanClient({ ...SETTINGS, fetchImpl: impl });
    await assert.rejects(client.createPlan(request()), /VIBLD_LOCAL_API_KEY/);
  });

  it('names a context window too small for the prompt, which Ollama cuts silently', async () => {
    // Ollama with a 2,048-token window read 1,026 tokens of a 40,000
    // character prompt and answered as though it had read it all.
    const { impl } = server([
      () =>
        new Response(
          sse(reply(GOOD, { prompt_tokens: 1_026, completion_tokens: 50 })),
        ),
    ]);
    const client = createLocalPlanClient({ ...SETTINGS, fetchImpl: impl });
    await assert.rejects(
      client.createPlan(request({ prompt: 'x'.repeat(40_000) })),
      (error: unknown) => {
        assert.ok(error instanceof LocalContextError);
        assert.equal(error.stop, 'context-exceeded');
        assert.match(
          error.message,
          /read 1026 tokens of the roughly 1\d{4} it was sent/,
        );
        assert.match(error.message, /OLLAMA_CONTEXT_LENGTH/);
        return true;
      },
    );
  });

  it('does not count reused tokens twice, so a cut prompt that was all reused is still caught', async () => {
    // In OpenAI's format the cached tokens are inside prompt_tokens.
    const { impl } = server([
      () =>
        new Response(
          sse(
            reply(GOOD, {
              prompt_tokens: 4_096,
              prompt_tokens_details: { cached_tokens: 4_096 },
            }),
          ),
        ),
    ]);
    const client = createLocalPlanClient({ ...SETTINGS, fetchImpl: impl });
    await assert.rejects(
      client.createPlan(request({ prompt: 'x'.repeat(40_000) })),
      LocalContextError,
    );
  });

  it('reads cached tokens as part of the prompt, as Ollama reports them', async () => {
    // Measured on Ollama 0.35: 2,176 prompt tokens, 2,162 of them cached.
    const { impl } = server([
      () =>
        new Response(
          sse(
            reply(GOOD, {
              prompt_tokens: 9_600,
              prompt_tokens_details: { cached_tokens: 9_000 },
            }),
          ),
        ),
    ]);
    const client = createLocalPlanClient({ ...SETTINGS, fetchImpl: impl });
    const completion = await client.createPlan(
      request({ prompt: 'x'.repeat(36_000) }),
    );
    assert.deepEqual(completion.plan, { summary: 'A bakery.', files: [] });
    assert.equal(completion.usage.inputTokens, 9_600);
  });

  it('catches a prompt that lost a fifth or more, not only half', async () => {
    // About 10,100 tokens sent, 7,000 read: a 31% loss.
    const { impl } = server([
      () => new Response(sse(reply(GOOD, { prompt_tokens: 7_000 }))),
    ]);
    const client = createLocalPlanClient({ ...SETTINGS, fetchImpl: impl });
    await assert.rejects(
      client.createPlan(request({ prompt: 'x'.repeat(40_000) })),
      LocalContextError,
    );
  });

  it('passes a whole prompt read by a tokenizer that packs more into a token', async () => {
    // 4.5 characters a token, more than the 3.89 measured on Qwen2.5.
    const { impl } = server([
      () => new Response(sse(reply(GOOD, { prompt_tokens: 9_000 }))),
    ]);
    const client = createLocalPlanClient({ ...SETTINGS, fetchImpl: impl });
    const completion = await client.createPlan(
      request({ prompt: 'x'.repeat(40_000) }),
    );
    assert.equal(completion.usage.inputTokens, 9_000);
  });

  it('accepts a prompt that tokenized denser than four characters a token', async () => {
    const { impl } = server([
      () => new Response(sse(reply(GOOD, { prompt_tokens: 14_000 }))),
    ]);
    const client = createLocalPlanClient({ ...SETTINGS, fetchImpl: impl });
    const completion = await client.createPlan(
      request({ prompt: 'x'.repeat(40_000) }),
    );
    assert.equal(completion.usage.inputTokens, 14_000);
  });

  it('reports a cut-off reply as truncation and an unreadable one as what came back', async () => {
    const { impl } = server([
      () => new Response(sse(reply('{"summary":"A bak', undefined, 'length'))),
      () => new Response(sse(reply('Here is your site!'))),
    ]);
    const client = createLocalPlanClient({ ...SETTINGS, fetchImpl: impl });
    const cut = await client.createPlan(request());
    assert.equal(cut.plan, null);
    assert.equal(cut.stopReason, 'max_tokens');
    assert.equal(cut.failure, undefined);
    const prose = await client.createPlan(request());
    assert.equal(prose.plan, null);
    assert.match(prose.failure?.reason ?? '', /not a JSON object/);
  });
});

describe('a local model that cannot finish a build', () => {
  it('says so plainly, for the failures a small model makes', () => {
    assert.match(
      withLocalAdvice(
        LOCAL_MODEL_ID,
        'model-shape',
        'The model returned junk.',
      ),
      /^The model returned junk\. This copy builds with a model running on its own machine, and that model could not finish\. A larger model usually can/,
    );
    assert.match(
      withLocalAdvice(LOCAL_MODEL_ID, 'model-truncated', 'Cut off.'),
      /A larger model usually can/,
    );
  });

  it('leaves every other failure, and every hosted model, as it was', () => {
    for (const stop of ['context-exceeded', 'provider-error'] as const) {
      assert.equal(
        withLocalAdvice(LOCAL_MODEL_ID, stop, 'As it was.'),
        'As it was.',
      );
    }
    assert.equal(
      withLocalAdvice('gpt-6-luna', 'model-shape', 'As it was.'),
      'As it was.',
    );
  });

  it('reaches the person through a real bounded build', async () => {
    // Prose where the outline should be, every time: what a model too
    // small for the request does.
    const { impl } = server(
      Array.from(
        { length: 4 },
        () => () =>
          new Response(
            sse(reply('Sure! Here is a plan for your bakery site.')),
          ),
      ),
    );
    const provider = new BoundedPlanProvider(
      createLocalPlanClient({ ...SETTINGS, fetchImpl: impl }),
      { model: LOCAL_MODEL_ID },
    );
    await assert.rejects(
      provider.generate({ prompt: 'A bakery.' }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.stop, 'model-shape');
        assert.match(error.message, /A larger model usually can/);
        return true;
      },
    );
  });
});
