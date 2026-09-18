import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MockupProvider } from '../src/mockup-provider.ts';
import { mockupMaxTokensFor } from '../src/plan-provider.ts';
import { MOCKUP_SYSTEM_PROMPT } from '../src/mockup-schema.ts';
import {
  ProviderRefusalError,
  ProviderShapeError,
  ProviderTruncationError,
} from '../src/errors.ts';
import type { PlanClient, PlanCompletion, PlanRequest } from '../src/client.ts';

/**
 * The run that produces three directions to choose between (#185).
 */

const USAGE = {
  inputTokens: 100,
  outputTokens: 9_000,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
};

function mockup(label: string) {
  return {
    label,
    rationale: 'One sentence about who this suits.',
    html: `<!doctype html><html><body>${label}</body></html>`,
  };
}

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
        plan: {
          mockups: [mockup('Quiet'), mockup('Loud'), mockup('Dense')],
        },
        stopReason: 'end_turn',
        usage: USAGE,
        ...completion,
      } as PlanCompletion;
    },
  };
}

describe('asking for three directions', () => {
  it('returns the set the model produced', async () => {
    const provider = new MockupProvider(client(), { model: 'deepseek-flash' });
    const set = await provider.generate({ prompt: 'a bakery' });
    assert.equal(set.mockups.length, 3);
    assert.deepEqual(
      set.mockups.map((each) => each.label),
      ['Quiet', 'Loud', 'Dense'],
    );
  });

  it('asks for a sketch-sized ceiling, not a build-sized one', async () => {
    const fake = client();
    await new MockupProvider(fake, { model: 'deepseek-flash' }).generate({
      prompt: 'a bakery',
    });
    assert.equal(fake.seen[0]?.maxTokens, mockupMaxTokensFor('deepseek-flash'));
  });

  it('sends the mockup prompt rather than the build prompt', async () => {
    // A mockup ships nothing, so it must not pay for the rules a shippable
    // project needs.
    const fake = client();
    await new MockupProvider(fake).generate({ prompt: 'a bakery' });
    assert.equal(fake.seen[0]?.system, MOCKUP_SYSTEM_PROMPT);
  });

  it('carries a chosen style into all three', async () => {
    // Somebody who already picked a direction is asking for three takes
    // within it, not three arguments against it.
    const fake = client();
    await new MockupProvider(fake, { style: 'brutalism' }).generate({
      prompt: 'a bakery',
    });
    assert.match(String(fake.seen[0]?.prompt), /a bakery/);
    assert.match(String(fake.seen[0]?.prompt), /within this visual direction/i);
  });

  it('asks for nothing about style when none was chosen', async () => {
    const fake = client();
    await new MockupProvider(fake).generate({ prompt: 'a bakery' });
    assert.equal(fake.seen[0]?.prompt, 'a bakery');
  });

  it('reports what it spent even when the answer is unusable', async () => {
    // A refusal still costs tokens. A ledger that counts only successes
    // under-reports the bill.
    const spent: unknown[] = [];
    const provider = new MockupProvider(
      client({ plan: { mockups: [] }, stopReason: 'end_turn' }),
      { onUsage: (usage) => spent.push(usage) },
    );
    await assert.rejects(
      provider.generate({ prompt: 'a bakery' }),
      ProviderShapeError,
    );
    assert.deepEqual(spent, [USAGE]);
  });

  it('names a refusal as a refusal', async () => {
    const provider = new MockupProvider(
      client({
        stopReason: 'refusal',
        refusal: { category: 'other', explanation: 'no' },
      }),
    );
    await assert.rejects(
      provider.generate({ prompt: 'a bakery' }),
      ProviderRefusalError,
    );
  });

  it('names a truncation against the ceiling it actually asked for', async () => {
    // The reason the completion reader is shared rather than copied: a
    // second copy is how this would come to report the build's ceiling.
    const provider = new MockupProvider(client({ stopReason: 'max_tokens' }), {
      model: 'deepseek-flash',
    });
    await assert.rejects(provider.generate({ prompt: 'a bakery' }), (error) => {
      assert.ok(error instanceof ProviderTruncationError);
      assert.match(
        String(error.message),
        new RegExp(String(mockupMaxTokensFor('deepseek-flash'))),
      );
      return true;
    });
  });
});

describe('reporting progress while sketching', () => {
  it('asks the client for progress and passes it on', async () => {
    // The claim that this route restores a real character count (#183) was
    // written before the callback was threaded, so it was false: the
    // provider never asked, and the client never reported (#189 review).
    const seen: number[] = [];
    const reporting: PlanClient = {
      id: 'fake',
      async createPlan(request: PlanRequest) {
        request.onProgress?.({ characters: 120 });
        request.onProgress?.({ characters: 400 });
        return {
          plan: { mockups: [mockup('A'), mockup('B'), mockup('C')] },
          stopReason: 'end_turn',
          usage: USAGE,
        } as PlanCompletion;
      },
    };

    await new MockupProvider(reporting, {
      onProgress: ({ characters }) => seen.push(characters),
    }).generate({ prompt: 'a bakery' });

    assert.deepEqual(seen, [120, 400]);
  });

  it('asks for nothing when no caller wants it', async () => {
    const fake = client();
    await new MockupProvider(fake).generate({ prompt: 'a bakery' });
    assert.equal(fake.seen[0]?.onProgress, undefined);
  });
});
