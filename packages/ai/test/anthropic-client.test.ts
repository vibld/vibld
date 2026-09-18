import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';

import { createAnthropicPlanClient, usageOf } from '../src/anthropic-client.ts';
import { MOCKUP_OUTPUT } from '../src/plan-output.ts';
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
});

/**
 * The schema in the request is the caller's, not this client's (#189
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
