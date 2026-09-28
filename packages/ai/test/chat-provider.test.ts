import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ChatProvider } from '../src/chat-provider.ts';
import { CHAT_SYSTEM_PROMPT } from '../src/chat-schema.ts';
import { CHAT_OUTPUT } from '../src/plan-output.ts';
import {
  CHAT_EFFORT,
  CHAT_OUTPUT_TOKENS,
  chatMaxTokensFor,
  mockupMaxTokensFor,
} from '../src/plan-provider.ts';
import {
  ProviderRefusalError,
  ProviderShapeError,
  ProviderTruncationError,
} from '../src/errors.ts';
import type { PlanClient, PlanCompletion, PlanRequest } from '../src/client.ts';

/**
 * One chat turn against a fake client (docs/decisions.md, 2026-09-28).
 */

const USAGE = {
  inputTokens: 900,
  outputTokens: 300,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
};

function client(
  completion: Partial<PlanCompletion> = {},
): PlanClient & { readonly seen: PlanRequest[] } {
  const seen: PlanRequest[] = [];
  return {
    id: 'fake',
    seen,
    async createPlan(request: PlanRequest) {
      seen.push(request);
      return {
        plan: { action: 'reply', message: 'It is a bakery site.', brief: null },
        stopReason: 'end_turn',
        usage: USAGE,
        ...completion,
      } as PlanCompletion;
    },
  };
}

const ASKED = {
  messages: [{ role: 'user' as const, text: 'What is this site?' }],
  project: { summary: 'A bakery site.', files: ['index.html'] },
};

describe('one chat turn', () => {
  it('returns a reply', async () => {
    const turn = await new ChatProvider(client(), {
      model: 'deepseek-flash',
    }).respond(ASKED);
    assert.deepEqual(turn, {
      action: 'reply',
      message: 'It is a bakery site.',
    });
  });

  it('returns a build with its brief', async () => {
    const turn = await new ChatProvider(
      client({
        plan: {
          action: 'build',
          message: 'Adding a Monthly / Yearly toggle to Pricing.',
          brief: 'Add a Monthly / Yearly toggle to the Pricing section.',
        },
      }),
      { model: 'deepseek-flash' },
    ).respond(ASKED);
    assert.deepEqual(turn, {
      action: 'build',
      message: 'Adding a Monthly / Yearly toggle to Pricing.',
      brief: 'Add a Monthly / Yearly toggle to the Pricing section.',
    });
  });

  it('asks for the chat shape, prompt, ceiling and effort', async () => {
    const fake = client();
    await new ChatProvider(fake, { model: 'deepseek-flash' }).respond(ASKED);
    const request = fake.seen[0]!;
    assert.equal(request.output, CHAT_OUTPUT);
    assert.equal(request.system, CHAT_SYSTEM_PROMPT);
    assert.equal(request.maxTokens, chatMaxTokensFor('deepseek-flash'));
    assert.equal(request.effort, CHAT_EFFORT);
    assert.ok(request.prompt.endsWith('[user]\nWhat is this site?'));
    assert.ok(request.prompt.includes('- index.html'));
  });

  it('reports usage even when the reply is the wrong shape', async () => {
    let reported: unknown;
    const provider = new ChatProvider(
      client({ plan: { action: 'build', message: 'Adding.', brief: null } }),
      {
        model: 'deepseek-flash',
        onUsage: (usage) => {
          reported = usage;
        },
      },
    );
    await assert.rejects(provider.respond(ASKED), ProviderShapeError);
    assert.deepEqual(reported, USAGE);
  });

  it('names a truncation and a refusal as what they are', async () => {
    await assert.rejects(
      new ChatProvider(client({ plan: null, stopReason: 'max_tokens' }), {
        model: 'deepseek-flash',
      }).respond(ASKED),
      (error: unknown) =>
        error instanceof ProviderTruncationError &&
        /the reply was cut off/.test(error.message),
    );
    await assert.rejects(
      new ChatProvider(client({ plan: null, stopReason: 'refusal' }), {
        model: 'deepseek-flash',
      }).respond(ASKED),
      ProviderRefusalError,
    );
  });

  it('never asks for more than a look would', () => {
    for (const model of ['deepseek-flash', 'claude-opus-5-5', 'gpt-6-astra']) {
      const ceiling = chatMaxTokensFor(model);
      assert.ok(ceiling <= CHAT_OUTPUT_TOKENS, model);
      assert.ok(ceiling <= mockupMaxTokensFor(model), model);
      assert.ok(ceiling > 0, model);
    }
  });
});
