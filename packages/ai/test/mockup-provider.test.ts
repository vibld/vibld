import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MockupProvider } from '../src/mockup-provider.ts';
import { mockupMaxTokensFor } from '../src/plan-provider.ts';
import { MOCKUP_SYSTEM_PROMPT, MockupSetSchema } from '../src/mockup-schema.ts';
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

/** A usage record that differs only in its output count, so a test can tell
 * which attempt was reported. */
function usageOf(outputTokens: number) {
  return { ...USAGE, outputTokens };
}

const VALID_SET = {
  mockups: [mockup('Quiet'), mockup('Loud'), mockup('Dense')],
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

  it('retries an empty reply once, and does not bill the reader for it', async () => {
    // DeepSeek's JSON mode documents that it may occasionally return empty
    // content, and a real run did: 22,828 characters streamed, 24,322
    // output tokens billed, and null where the object should have been
    // (#190). The reader did not cause that, so they do not pay for it.
    let call = 0;
    const billed: number[] = [];
    const absorbed: number[] = [];
    const flaky = {
      id: 'flaky',
      async createPlan() {
        call += 1;
        return call === 1
          ? { plan: null, stopReason: 'end_turn', usage: usageOf(9999) }
          : { plan: VALID_SET, stopReason: 'end_turn', usage: usageOf(11) };
      },
    } as unknown as PlanClient;

    const provider = new MockupProvider(flaky, {
      model: 'deepseek-flash',
      onUsage: (u) => billed.push(u.outputTokens),
      onDiscarded: (u) => absorbed.push(u.outputTokens),
    });
    const set = await provider.generate({ prompt: 'a bakery' });

    assert.equal(call, 2, 'the empty reply was not retried');
    assert.equal(set.mockups.length, 3);
    assert.deepEqual(billed, [11], 'the reader was billed for the empty reply');
    assert.deepEqual(absorbed, [9999], 'the discarded attempt went unreported');
  });

  it('does not retry a reply that is merely the wrong shape', async () => {
    // A disagreement about shape is one the model will most likely repeat,
    // so retrying spends twice and fails anyway. Only "nothing came back"
    // is worth a second attempt.
    let call = 0;
    const wrong = {
      id: 'wrong',
      async createPlan() {
        call += 1;
        return {
          plan: { mockups: 'not an array' },
          stopReason: 'end_turn',
          usage: usageOf(7),
        };
      },
    } as unknown as PlanClient;

    const provider = new MockupProvider(wrong, { model: 'deepseek-flash' });
    await assert.rejects(provider.generate({ prompt: 'a bakery' }));
    assert.equal(call, 1, 'a wrong shape was retried, doubling the bill');
  });

  it('names what it asked for when the shape is wrong', async () => {
    // The sibling I missed. Truncation got a vocabulary one commit before a
    // real run failed on this instead, still saying "the model returned a
    // plan" to somebody who asked for three sketches (#190). DeepSeek's
    // JSON mode documents that it may occasionally return empty content,
    // so this is a path real runs take, not a theoretical one.
    const provider = new MockupProvider(
      client({ plan: null, stopReason: 'end_turn' }),
      { model: 'deepseek-flash' },
    );
    await assert.rejects(provider.generate({ prompt: 'a bakery' }), (error) => {
      const message = String((error as Error).message);
      assert.match(message, /set of three directions/);
      assert.doesNotMatch(message, /returned a plan/);
      return true;
    });
  });

  it('says what is incomplete, which is not a project', async () => {
    // The test above asserts the ceiling and passed while the message was
    // the build's: somebody who asked for three sketches was told "the
    // generated project is incomplete. Ask for a smaller project, or build
    // it a few pages at a time." The first real run against a model
    // produced exactly that (#190), which is how an assertion about a
    // number and not about the words lets wrong advice ship.
    const provider = new MockupProvider(client({ stopReason: 'max_tokens' }), {
      model: 'deepseek-flash',
    });
    await assert.rejects(provider.generate({ prompt: 'a bakery' }), (error) => {
      const message = String((error as Error).message);
      assert.match(message, /directions/);
      assert.doesNotMatch(message, /project/);
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

/**
 * What this provider tells the client it wants back (#189 review, P1).
 *
 * The gap this closes is the reason that P1 shipped at all. Every test in
 * this file uses a fake client, so the provider was exercised end to end
 * while the one thing never asserted was whether it *asks* for a mockup
 * set. It did not: the shape was hard-coded in each real client, so on
 * Anthropic and OpenAI the API constrained the reply to a generation plan
 * and on DeepSeek the appended instruction demanded one.
 *
 * A fake client can still check this, which is the point: the request is
 * the contract, and it was never being read.
 */
describe('what the request asks the model for', () => {
  it('tells the client it wants a mockup set, not a plan', async () => {
    const fake = client();
    await new MockupProvider(fake, {
      model: 'deepseek-flash',
      maxTokens: 18_000,
      effort: 'high',
    }).generate({ prompt: 'a bakery' });

    const output = fake.seen[0]?.output;
    assert.ok(output, 'the request said nothing about the shape it wants');
    assert.equal(output.name, 'mockup_set');
    assert.equal(output.schema, MockupSetSchema);
  });

  it('asks for the schema it is about to validate against', async () => {
    // The two must be the same object, not merely similar. A provider that
    // requested one shape and checked another is the bug, restated.
    const fake = client();
    await new MockupProvider(fake, {
      model: 'deepseek-flash',
      maxTokens: 18_000,
      effort: 'high',
    }).generate({ prompt: 'a bakery' });

    const parsed = fake.seen[0]!.output!.schema.safeParse({
      mockups: [mockup('Quiet'), mockup('Loud')],
    });
    assert.equal(parsed.success, true, 'the requested schema rejects mockups');
  });
});
