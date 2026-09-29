import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import AnthropicSdk from '@anthropic-ai/sdk';
import type Anthropic from '@anthropic-ai/sdk';

import { createAnthropicPlanClient, usageOf } from '../src/anthropic-client.ts';
import { ProviderTruncationError } from '../src/errors.ts';
import { MOCKUP_OUTPUT, PLAN_OUTPUT } from '../src/plan-output.ts';
import { readCompletion } from '../src/plan-provider.ts';
import type { PlanOutput } from '../src/plan-output.ts';

/**
 * The one request shape that decides whether prompt caching happens at all.
 *
 * Asserted rather than trusted, because the failure mode is silent: the cache
 * directive is read from inside a content block, and at the message level it
 * is ignored with no error. A marker in the wrong place produces a working
 * request, a correct plan and an unchanged bill, which is indistinguishable
 * from a caching scheme that was never wired up.
 */

interface Captured {
  system?: unknown;
  messages?: unknown;
  model?: string;
  output_config?: unknown;
}

function fakeAnthropic(captured: Captured): Anthropic {
  return {
    messages: {
      stream(params: Record<string, unknown>) {
        Object.assign(captured, params);
        return {
          on() {},
          async finalMessage() {
            return {
              content: [{ type: 'text', text: '{"summary":"s","files":[]}' }],
              stop_reason: 'end_turn',
              usage: {
                input_tokens: 100,
                output_tokens: 200,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
              },
            };
          },
        };
      },
    },
  } as unknown as Anthropic;
}

async function sendOne(): Promise<Captured> {
  const captured: Captured = {};
  const client = createAnthropicPlanClient({ client: fakeAnthropic(captured) });
  await client.createPlan({
    model: 'claude-haiku-4-5',
    system: 'SYSTEM PROMPT',
    prompt: 'Build a landing page',
    maxTokens: 1000,
    effort: 'high',
  });
  return captured;
}

describe('the cache breakpoint', () => {
  it('marks the system prompt, inside a content block', async () => {
    const { system } = await sendOne();

    assert.ok(Array.isArray(system), 'the system prompt was sent as a string');
    const blocks = system as {
      type: string;
      text: string;
      cache_control?: unknown;
    }[];
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, 'text');
    assert.equal(blocks[0]?.text, 'SYSTEM PROMPT');
    assert.deepEqual(blocks[0]?.cache_control, { type: 'ephemeral' });
  });

  it('marks nothing else', async () => {
    // There is a hard cap on markers per request, and only one part of this
    // request is byte-identical between runs. A marker on the user message,
    // which starts with the person's own words, pays the write premium every
    // time and matches nothing.
    const { messages } = await sendOne();

    assert.equal(
      JSON.stringify(messages).includes('cache_control'),
      false,
      'a second marker was placed on content that changes every run',
    );
  });
});

describe('the cache breakpoint a bounded build asks for', () => {
  it('marks the end of the shared prefix, and sends the rest after it', async () => {
    // A bounded build repeats the request, spec and manifest on every
    // file-writing step. That part is byte-identical within a run, so it is
    // the one part of a user message a marker can honestly go on.
    const captured: Captured = {};
    const client = createAnthropicPlanClient({
      client: fakeAnthropic(captured),
    });
    let reported = 0;
    await client.createPlan({
      model: 'claude-haiku-4-5',
      system: 'SYSTEM PROMPT',
      cachePrefix: 'SHARED PLAN',
      prompt: 'WRITE THESE',
      maxTokens: 1000,
      effort: 'high',
      onPromptChars: (characters) => {
        reported = characters;
      },
    });

    const [message] = captured.messages as {
      role: string;
      content: { type: string; text: string; cache_control?: unknown }[];
    }[];
    assert.deepEqual(message?.content, [
      {
        type: 'text',
        text: 'SHARED PLAN',
        cache_control: { type: 'ephemeral' },
      },
      { type: 'text', text: 'WRITE THESE' },
    ]);
    assert.equal(
      reported,
      'SYSTEM PROMPT'.length + 'SHARED PLAN'.length + 'WRITE THESE'.length,
    );
  });
});

describe('reading Anthropic usage', () => {
  it('counts cached and written tokens as part of the input', async () => {
    // Anthropic's `input_tokens` is the uncached remainder: unlike OpenAI and
    // DeepSeek it does not include the cache figures. Mapped straight across,
    // the same field would mean two different things in one codebase.
    assert.deepEqual(
      usageOf({
        input_tokens: 100,
        output_tokens: 200,
        cache_read_input_tokens: 2_000,
        cache_creation_input_tokens: 700,
      }),
      {
        inputTokens: 2_800,
        outputTokens: 200,
        cacheReadInputTokens: 2_000,
        cacheWriteInputTokens: 700,
      },
    );
  });

  it('reads a response that reports no cache fields at all', async () => {
    assert.deepEqual(usageOf({ input_tokens: 10, output_tokens: 20 }), {
      inputTokens: 10,
      outputTokens: 20,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
    });
  });

  it('records thinking as reasoning, inside the output it is billed in', async () => {
    const usage = usageOf({
      input_tokens: 10,
      output_tokens: 900,
      output_tokens_details: { thinking_tokens: 600 },
    });
    assert.equal(usage.outputTokens, 900);
    assert.equal(usage.reasoningTokens, 600);
    // Not reported is not zero.
    assert.equal(
      'reasoningTokens' in
        usageOf({
          input_tokens: 1,
          output_tokens: 1,
          output_tokens_details: null,
        }),
      false,
    );
  });
});

/**
 * The schema in the request is the caller's, not this client's (internal PR 189
 * review, P1).
 *
 * `output_config.format` was `zodOutputFormat(GenerationPlanSchema)`
 * whatever was asked for, so a mockup run was *structurally* prevented from
 * succeeding: the prompt asked for a set of directions and the API
 * constrained the reply to a generation plan. The model complies with the
 * API, `MockupSetSchema` rejects what comes back, and the caller pays for a
 * refusal they did not cause.
 *
 * Asserted against what was requested rather than against any particular
 * schema, because the bug was a client that had an opinion about the shape
 * at all.
 */
describe('the shape a request asks for', () => {
  async function sendWith(output?: PlanOutput): Promise<Captured> {
    const captured: Captured = {};
    const client = createAnthropicPlanClient({
      client: fakeAnthropic(captured),
    });
    await client.createPlan({
      model: 'claude-haiku-4-5',
      system: 'SYSTEM PROMPT',
      prompt: 'Build a landing page',
      maxTokens: 1000,
      effort: 'high',
      ...(output ? { output } : {}),
    });
    return captured;
  }

  it('sends the mockup schema when a mockup set was asked for', async () => {
    const captured = await sendWith(MOCKUP_OUTPUT);
    const format = JSON.stringify(
      (captured.output_config as { format?: unknown })?.format,
    );
    assert.match(format, /mockups/, 'the request did not ask for mockups');
    assert.doesNotMatch(format, /"files"/, 'it asked for a plan instead');
  });

  it('still asks for a plan when nothing says otherwise', async () => {
    const captured = await sendWith();
    const format = JSON.stringify(
      (captured.output_config as { format?: unknown })?.format,
    );
    assert.match(format, /files/, 'the default stopped being a plan');
  });
});

/**
 * How large a prompt this client says it sent (internal PR 189 review).
 *
 * As with OpenAI, the schema travels in a structured field rather than in
 * the prompt, so this reports the two strings it was handed. Pinned because
 * the figure settles a cancelled run and DeepSeek's answer differs.
 */
describe('what the Anthropic client reports sending', () => {
  it('counts the system and user prompts it was given', async () => {
    const captured: Captured = {};
    let reported = -1;
    await createAnthropicPlanClient({
      client: fakeAnthropic(captured),
    }).createPlan({
      model: 'claude-haiku-4-5',
      system: 'SYSTEM PROMPT',
      prompt: 'Build a landing page',
      maxTokens: 1000,
      effort: 'high',
      onPromptChars: (characters) => {
        reported = characters;
      },
    });
    assert.equal(
      reported,
      'SYSTEM PROMPT'.length + 'Build a landing page'.length,
    );
  });
});

/**
 * A reply cut off at the output ceiling reads as truncated (internal PR 73).
 *
 * Through the real SDK rather than the double above, because the double is
 * where this hid: the SDK's stream parses the structured output inside
 * `finalMessage` whenever the format carries a `parse` function, and threw
 * "Unterminated string" before `stop_reason` could be read. A double that
 * returns the message directly never runs that code.
 */
describe('a reply cut off at the output ceiling', () => {
  function sse(events: [string, unknown][]): string {
    return events
      .map(
        ([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
      )
      .join('');
  }

  function streamingAnthropic(text: string, stopReason: string): Anthropic {
    const body = sse([
      [
        'message_start',
        {
          type: 'message_start',
          message: {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-haiku-4-5',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        },
      ],
      [
        'content_block_start',
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
      ],
      [
        'content_block_delta',
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text },
        },
      ],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      [
        'message_delta',
        {
          type: 'message_delta',
          delta: { stop_reason: stopReason, stop_sequence: null },
          usage: { output_tokens: 1000 },
        },
      ],
      ['message_stop', { type: 'message_stop' }],
    ]);
    return new AnthropicSdk({
      apiKey: 'test-key',
      maxRetries: 0,
      fetch: async () =>
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    });
  }

  async function planFrom(text: string, stopReason: string) {
    return createAnthropicPlanClient({
      client: streamingAnthropic(text, stopReason),
    }).createPlan({
      model: 'claude-haiku-4-5',
      system: 'SYSTEM PROMPT',
      prompt: 'Build a landing page',
      maxTokens: 1000,
      effort: 'high',
    });
  }

  it('reports the stop reason rather than a parse error', async () => {
    const completion = await planFrom(
      '{"summary":"s","files":[{"path":"index.html","content":"<html',
      'max_tokens',
    );
    assert.equal(completion.stopReason, 'max_tokens');
    assert.equal(completion.plan, null);
  });

  it('is named as a truncation by the provider', async () => {
    const completion = await planFrom(
      '{"summary":"s","files":[{"pa',
      'max_tokens',
    );
    assert.throws(
      () => readCompletion(completion, 1000, PLAN_OUTPUT.schema),
      ProviderTruncationError,
    );
  });

  it('still reads a reply that finished', async () => {
    const completion = await planFrom('{"summary":"s","files":[]}', 'end_turn');
    assert.deepEqual(completion.plan, { summary: 's', files: [] });
  });
});
