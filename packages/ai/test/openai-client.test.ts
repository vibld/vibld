import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OPENAI_BASE_URL,
  createOpenaiPlanClient,
  mapResponseStatus,
  planJsonSchema,
  readOutputText,
  readRefusal,
  readResponseStream,
} from '../src/openai-client.ts';
import type { PlanRequest } from '../src/client.ts';

const REQUEST: PlanRequest = {
  system: 'system',
  prompt: 'prompt',
  model: 'gpt-5.6-terra',
  maxTokens: 64000,
  effort: 'high',
};

function sse(...events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n'));
      controller.close();
    },
  });
}

const PLAN = { summary: 'A page', files: [{ path: 'a.tsx', content: 'x' }] };

function completed(overrides: Record<string, unknown> = {}) {
  return {
    type: 'response.completed',
    response: {
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(PLAN) }],
        },
      ],
      usage: {
        input_tokens: 11,
        output_tokens: 22,
        input_tokens_details: { cached_tokens: 3 },
      },
      ...overrides,
    },
  };
}

describe('planJsonSchema', () => {
  it('keeps what strict mode requires', () => {
    const schema = planJsonSchema();
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, ['summary', 'files']);
    const files = (schema.properties as Record<string, Record<string, unknown>>)
      .files;
    const item = files.items as Record<string, unknown>;
    assert.equal(item.additionalProperties, false);
    assert.deepEqual(item.required, ['path', 'content']);
  });

  it('strips the keywords strict mode will not take', () => {
    // Dropping these loses nothing: PlanProvider re-runs the real Zod schema
    // over whatever comes back. Sending one the API rejects fails every
    // request; sending a looser schema fails none.
    const serialised = JSON.stringify(planJsonSchema());
    for (const banned of ['$schema', 'minLength', 'minItems']) {
      assert.ok(!serialised.includes(banned), banned);
    }
  });
});

describe('readResponseStream', () => {
  it('accumulates deltas and reports progress', () => {
    const seen: number[] = [];
    return readResponseStream(
      sse(
        { type: 'response.created', response: { status: 'in_progress' } },
        { type: 'response.output_text.delta', delta: 'he' },
        { type: 'response.output_text.delta', delta: 'llo' },
        completed(),
      ),
      (characters) => seen.push(characters),
    ).then(({ text, response }) => {
      assert.equal(text, 'hello');
      assert.deepEqual(seen, [2, 5]);
      assert.equal(response?.status, 'completed');
    });
  });

  it('takes the terminal object from any event carrying one', async () => {
    // The terminal event's exact name was not verifiable when this was
    // written, so the parser keys on a terminal `status` rather than a name.
    for (const type of ['response.completed', 'response.done', 'whatever']) {
      const { response } = await readResponseStream(
        sse({ ...completed(), type }),
      );
      assert.equal(response?.status, 'completed', type);
    }
  });

  it('survives a frame that is not JSON', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {not json\n'));
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(completed())}\n`),
        );
        controller.close();
      },
    });
    const { response } = await readResponseStream(stream);
    assert.equal(response?.status, 'completed');
  });

  it('does not assume a frame fits in one chunk', async () => {
    const encoder = new TextEncoder();
    const whole = `data: ${JSON.stringify(completed())}\n`;
    const split = Math.floor(whole.length / 2);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(whole.slice(0, split)));
        controller.enqueue(encoder.encode(whole.slice(split)));
        controller.close();
      },
    });
    const { response } = await readResponseStream(stream);
    assert.equal(response?.status, 'completed');
  });
});

describe('mapResponseStatus', () => {
  it('maps a completed response to end_turn', () => {
    assert.equal(mapResponseStatus({ status: 'completed' }), 'end_turn');
  });

  it('maps a hit output ceiling to max_tokens', () => {
    // Without this, ProviderTruncationError can never fire and a cut-off
    // project surfaces as an unreadable JSON parse failure.
    assert.equal(
      mapResponseStatus({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
      }),
      'max_tokens',
    );
  });

  it('finds a refusal even on an otherwise completed response', () => {
    // A refusal arrives as a content block, not as a status, so reading
    // status alone would report it as a clean finish with a broken plan.
    assert.equal(
      mapResponseStatus({
        status: 'completed',
        output: [
          { type: 'message', content: [{ type: 'refusal', refusal: 'no' }] },
        ],
      }),
      'refusal',
    );
  });
});

describe('readOutputText and readRefusal', () => {
  it('find their block, or null', () => {
    const response = completed().response;
    assert.equal(readOutputText(response), JSON.stringify(PLAN));
    assert.equal(readRefusal(response), null);
    assert.equal(readOutputText({ output: [] }), null);
  });
});

describe('createOpenaiPlanClient', () => {
  function clientWith(
    stream: ReadableStream<Uint8Array>,
    seen: unknown[] = [],
  ) {
    return createOpenaiPlanClient({
      apiKey: 'test-key',
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(stream, { status: 200 });
      }) as unknown as typeof fetch,
    });
  }

  it('posts the schema in strict mode to the responses endpoint', async () => {
    const seen: Record<string, never>[] = [];
    const result = await clientWith(sse(completed()), seen).createPlan(REQUEST);
    const call = seen[0] as unknown as {
      url: string;
      body: Record<string, never>;
    };
    assert.equal(call.url, `${OPENAI_BASE_URL}/responses`);
    const format = (call.body as Record<string, Record<string, unknown>>).text
      .format as Record<string, unknown>;
    assert.equal(format.type, 'json_schema');
    assert.equal(format.strict, true);
    assert.equal((call.body as Record<string, unknown>).stream, true);
    assert.deepEqual(result.plan, PLAN);
    assert.equal(result.stopReason, 'end_turn');
  });

  it('opts out of response storage', async () => {
    // The Responses API stores by default, and this request carries the whole
    // project. Picking an OpenAI model must not change where a user's code
    // ends up, so the absence of this field is a privacy regression, not a
    // stylistic one.
    const seen: unknown[] = [];
    await clientWith(sse(completed()), seen).createPlan(REQUEST);
    const body = (seen[0] as { body: Record<string, unknown> }).body;
    assert.equal(body.store, false);
  });

  it('clamps max_output_tokens to the model ceiling', async () => {
    const seen: unknown[] = [];
    await clientWith(sse(completed()), seen).createPlan({
      ...REQUEST,
      maxTokens: 900_000,
    });
    const body = (seen[0] as { body: Record<string, number> }).body;
    assert.equal(body.max_output_tokens, 128_000);
  });

  it('reports real usage, and estimates only when the stream omits it', async () => {
    const withUsage = await clientWith(sse(completed())).createPlan(REQUEST);
    assert.deepEqual(withUsage.usage, {
      inputTokens: 11,
      outputTokens: 22,
      cacheReadInputTokens: 3,
    });

    const withoutUsage = await clientWith(
      sse(completed({ usage: null })),
    ).createPlan(REQUEST);
    assert.ok(withoutUsage.usage.inputTokens > 0);
    assert.ok(withoutUsage.usage.outputTokens > 0);
  });

  it('returns a null plan and a refusal rather than parsing garbage', async () => {
    const result = await clientWith(
      sse({
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'refusal', refusal: 'I cannot help' }],
            },
          ],
        },
      }),
    ).createPlan(REQUEST);
    assert.equal(result.plan, null);
    assert.equal(result.stopReason, 'refusal');
    assert.equal(result.refusal?.explanation, 'I cannot help');
  });

  it('names truncation as truncation, with the partial text unparsed', async () => {
    const result = await clientWith(
      sse({
        type: 'response.completed',
        response: {
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: '{"summary":"cut off' }],
            },
          ],
        },
      }),
    ).createPlan(REQUEST);
    assert.equal(result.stopReason, 'max_tokens');
    assert.equal(result.plan, null);
  });

  it('keeps a finished plan even when no terminal event arrived', async () => {
    // Losing a completed generation to a missing frame would charge someone
    // for work that was actually done.
    const result = await clientWith(
      sse({ type: 'response.output_text.delta', delta: JSON.stringify(PLAN) }),
    ).createPlan(REQUEST);
    assert.deepEqual(result.plan, PLAN);
  });

  it('refuses to run without a key, and never leaks it on an error', async () => {
    await assert.rejects(
      () => createOpenaiPlanClient({ apiKey: '' }).createPlan(REQUEST),
      /OPENAI_API_KEY is not set/,
    );

    const failing = createOpenaiPlanClient({
      apiKey: 'super-secret-key',
      fetchImpl: (async () =>
        new Response('upstream detail', { status: 500 })) as typeof fetch,
    });
    await assert.rejects(
      () => failing.createPlan(REQUEST),
      (error: Error) => {
        assert.match(error.message, /OpenAI rejected the request \(500\)/);
        assert.ok(!error.message.includes('super-secret-key'));
        return true;
      },
    );
  });
});
