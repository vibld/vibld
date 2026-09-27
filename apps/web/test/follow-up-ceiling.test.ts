import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  MODEL_CATALOGUE,
  RUN_STEP_TIMEOUT_MS,
  RUN_WALL_CLOCK_BUDGET_MS,
  maxTokensFor,
  outputTokensPerSecondFor,
} from '@vibld/ai';
import {
  MAX_BASE_CONTENT_CHARS,
  outputTokensToCarry,
  outputTokensToRewrite,
  projectChars,
} from '@vibld/ai/limits';

import {
  carryTokensFor,
  runCeilingFor,
  sizedReservation,
} from '../worker/run-ceiling.ts';
import { worstCaseMicroUsd } from '../worker/spend.ts';

/**
 * A follow-up's ceiling, sized to the project it has to carry (internal issue 209).
 *
 * A follow-up returns the complete set of files, so it spends its first
 * tokens re-emitting what already exists. The flat $1.60 reserve (now
 * $3.20) was sized for building something new, and on the expensive models it bought less
 * than a large project takes to carry at all: the run of 2026-09-23 was a
 * 63,903-character project against 32,000 tokens on GPT-6 Astra, which ran
 * ten and a half minutes and came back truncated.
 *
 * The fix gives a follow-up the room a first run gets plus the cost of
 * carrying. What must not move is the clock: a ceiling the model cannot
 * reach in the time allowed is a timeout, whatever the caller can afford.
 */

/** The project from the failing run, as it is stored. */
const LIVE_PROJECT_CHARS = 63_903;
const LIVE_CARRY = outputTokensToCarry(LIVE_PROJECT_CHARS);

/**
 * The most any follow-up can carry: the largest base a follow-up may send.
 * `carryTokensFor` gives nothing past it, which is what makes this the
 * largest rather than merely a large one.
 */
const LARGEST_CARRY = outputTokensToCarry(MAX_BASE_CONTENT_CHARS);

describe('what a follow-up may ask for', () => {
  it('gives a first run exactly what it had before', () => {
    // The whole change is additive. A run with nothing to carry must not
    // move by a token, on any model, or this has repriced every generation
    // to fix one kind.
    for (const model of MODEL_CATALOGUE) {
      assert.equal(
        maxTokensFor(model.id, undefined, 0),
        maxTokensFor(model.id),
        `${model.id}: a first run was resized`,
      );
    }
  });

  it('gives the live failure room it did not have, within the time allowed', () => {
    // GPT-6 Astra buys 32,000 tokens with the reserve and needs about
    // 50,000 to carry this project, sized at the unfavourable end of the
    // measured range. Its own measured speed is what caps it now, rather
    // than the dollar figure.
    const ceiling = maxTokensFor('gpt-6-astra', undefined, LIVE_CARRY);
    const reachable = Math.floor(
      (RUN_WALL_CLOCK_BUDGET_MS / 1000) *
        outputTokensPerSecondFor('gpt-6-astra'),
    );

    assert.ok(ceiling > 32_000, 'the follow-up got no more room than before');
    // Stated both ways, because the truth sits between them. At the
    // favourable end of the measured range the room clears the carry; at
    // the unfavourable end it does not, and no amount of money changes that:
    // it is what this model can write in fifteen minutes. So a follow-up on
    // this project fits on GPT-6 Astra only if it thinks lightly, and a
    // faster model is the reliable choice for it.
    assert.ok(
      ceiling > outputTokensToRewrite(LIVE_PROJECT_CHARS),
      'the follow-up cannot carry the project even at the favourable end',
    );
    assert.ok(
      ceiling < LIVE_CARRY,
      'the clock no longer binds GPT-6 Astra here; revisit what this says',
    );
    assert.equal(
      ceiling,
      reachable,
      'the ceiling is not the one the clock allows',
    );
    // The figure the maintainer approved the change on: 45,900 tokens.
    assert.equal(ceiling, 45_900);
  });

  it('reserves what the maintainer approved for that run', () => {
    // Approved as "about $2.30 instead of $1.60" for this project on this
    // model. Since the reserve became $3.20 (ADR-0014), a first run on GPT-6
    // Astra already gets that much: its ceiling is what it can write inside
    // the clock, so a follow-up carrying this project asks for no more.
    const env = { VIBLD_PROVIDER: 'openai' };
    const before = runCeilingFor(env, 'gpt-6-astra');
    const after = runCeilingFor(env, 'gpt-6-astra', 'build', LIVE_CARRY);

    assert.equal(before.maxTokens * before.prices.outputMicroUsd, 2_295_000);
    assert.equal(after.maxTokens, before.maxTokens);
  });

  it('lets the money bound grow where the clock does not bind', () => {
    // Claude Fable 5.1 is not measured, so it is clocked at the default
    // rate, which is far above what the reserve buys at 50 micro-USD a
    // token. The carry is the whole difference.
    const first = maxTokensFor('claude-fable-5-1');
    const followUp = maxTokensFor('claude-fable-5-1', undefined, LIVE_CARRY);

    assert.equal(followUp, first + LIVE_CARRY);
    const prices = runCeilingFor({}, 'claude-fable-5-1').prices;
    assert.ok(
      worstCaseMicroUsd(prices, followUp, 0) >
        worstCaseMicroUsd(prices, first, 0),
      'the reservation did not grow with the room',
    );
  });

  it('never asks a model for more than it can write, however much it carries', () => {
    for (const model of MODEL_CATALOGUE) {
      assert.ok(
        maxTokensFor(model.id, undefined, LARGEST_CARRY) <=
          model.maxOutputTokens,
        `${model.id}: asked past its own maximum`,
      );
    }
  });

  it('never asks a model for more than it can write in time, however much it carries', () => {
    // The property the clock exists for, asked at each model's own speed
    // and at the largest project a follow-up can carry. A single global
    // rate made this five and a half times too generous for GPT-6 Astra.
    const seconds = RUN_WALL_CLOCK_BUDGET_MS / 1000;
    for (const model of MODEL_CATALOGUE) {
      const ceiling = maxTokensFor(model.id, undefined, LARGEST_CARRY);
      const needed = ceiling / outputTokensPerSecondFor(model.id);
      assert.ok(
        needed <= seconds,
        `${model.id}: ${ceiling} tokens needs ${Math.round(needed)}s of ${seconds}s`,
      );
    }
  });

  it('still finishes inside the timeout at half its own speed', () => {
    for (const model of MODEL_CATALOGUE) {
      const ceiling = maxTokensFor(model.id, undefined, LARGEST_CARRY);
      const halfRate = outputTokensPerSecondFor(model.id) / 2;
      const needed = (ceiling / halfRate) * 1000;
      assert.ok(
        needed <= RUN_STEP_TIMEOUT_MS,
        `${model.id}: at half speed needs ${Math.round(needed)}ms of ${RUN_STEP_TIMEOUT_MS}ms`,
      );
    }
  });

  it('adds nothing for a carry that is not a usable count', () => {
    for (const carry of [Number.NaN, -1, Number.NEGATIVE_INFINITY]) {
      assert.equal(
        maxTokensFor('claude-opus-5', undefined, carry),
        maxTokensFor('claude-opus-5'),
        `a carry of ${carry} moved the ceiling`,
      );
    }
  });

  it('leaves a mockup run alone, which carries nothing back', () => {
    const env = { VIBLD_PROVIDER: 'openai' };
    assert.equal(
      runCeilingFor(env, 'gpt-6-astra', 'mockups', LIVE_CARRY).maxTokens,
      runCeilingFor(env, 'gpt-6-astra', 'mockups').maxTokens,
    );
  });
});

describe('what a follow-up carries, read before it starts', () => {
  const FILES = [
    { path: 'src/App.tsx', content: 'export default () => null;' },
    { path: 'index.html', content: '<div id="root"></div>' },
  ];

  type Stored = {
    revision: string;
    files: { path: string; content: string }[];
  };

  function storeWith(load: () => Promise<Stored | undefined>) {
    let reads = 0;
    return {
      reads: () => reads,
      store: {
        loadAccepted: async () => {
          reads += 1;
          return (await load()) as never;
        },
      },
    };
  }

  it('carries the stored project, measured the way the run measures it', async () => {
    const { store } = storeWith(async () => ({ revision: 'r1', files: FILES }));

    assert.equal(
      await carryTokensFor(store, 'user_abc', 'r1'),
      outputTokensToCarry(projectChars(FILES)),
    );
  });

  it('reads nothing for a first run', async () => {
    // No base, nothing to carry, and no reason to touch storage on the
    // request path of every new project.
    const { store, reads } = storeWith(async () => ({
      revision: 'r1',
      files: FILES,
    }));

    assert.equal(await carryTokensFor(store, 'user_abc', undefined), 0);
    assert.equal(reads(), 0, 'a first run read the project anyway');
  });

  it('sizes the run as a first run when the project cannot be read', async () => {
    // A sizing hint, not the run's own read: that one is authoritative and
    // fails the run properly. Refusing the request here would turn a hint
    // into an outage.
    const { store } = storeWith(async () => {
      throw new Error('R2 is unreachable');
    });

    assert.equal(await carryTokensFor(store, 'user_abc', 'r1'), 0);
  });

  it('carries nothing when there is no accepted project', async () => {
    const { store } = storeWith(async () => undefined);

    assert.equal(await carryTokensFor(store, 'user_abc', 'r1'), 0);
  });

  it('carries nothing for a revision that has moved on', async () => {
    // Another tab promoted since this one loaded. `runGeneration` refuses
    // this as a conflict for free, before the model is asked (internal PR 210 review).
    // Sizing it up could make `reserve` refuse it first, and the person
    // would be told they are out of budget instead of that their project
    // changed underneath them.
    const { store } = storeWith(async () => ({ revision: 'r2', files: FILES }));

    assert.equal(await carryTokensFor(store, 'user_abc', 'r1'), 0);
  });

  it('carries nothing for a project too large to send, and everything up to it', async () => {
    // The same reasoning at the other refusal: past the size limit the run
    // is refused as `context-exceeded` for free, and that is the message
    // somebody has to see, not an allowance one. Held at the boundary so
    // the line is the run's own line and not near it.
    function sized(chars: number): Stored {
      return {
        revision: 'r1',
        files: [{ path: 'a', content: 'x'.repeat(chars - 1) }],
      };
    }
    const at = storeWith(async () => sized(MAX_BASE_CONTENT_CHARS));
    const over = storeWith(async () => sized(MAX_BASE_CONTENT_CHARS + 1));

    assert.equal(
      await carryTokensFor(at.store, 'user_abc', 'r1'),
      LARGEST_CARRY,
      'the largest project a follow-up may send was not carried',
    );
    assert.equal(
      await carryTokensFor(over.store, 'user_abc', 'r1'),
      0,
      'a project the run will refuse was sized up anyway',
    );
  });
});

describe('the request sizes a follow-up before it reserves', () => {
  // `index.ts` imports `cloudflare:workers` and cannot be loaded under
  // `node --test`, so the call is read as source, the same way
  // `durable-objects.test.ts` reads its export line. What matters is that
  // the carry reaches the ceiling the reservation is priced from: computed
  // and then dropped, it would leave every follow-up exactly as it was.
  const source = readFileSync(
    join(import.meta.dirname, '..', 'worker', 'index.ts'),
    'utf8',
  );
  const handlePlan = source.slice(
    source.indexOf('async function handlePlan('),
    source.indexOf('async function handleMockups('),
  );

  it('found the handler it is reading', () => {
    assert.ok(
      handlePlan.length > 0 && handlePlan.includes('worstCaseMicroUsd('),
      'the region this reads has moved; the assertions below prove nothing',
    );
  });

  it('passes what the follow-up carries to the ceiling it reserves against', () => {
    assert.match(
      handlePlan,
      /runCeilingFor\(\s*env,\s*effectiveModel,\s*'build',\s*carryTokens,?\s*\)/,
      'the ceiling is not sized by the carry it is handed',
    );
    assert.match(
      handlePlan,
      /sizedReservation\(\s*carry,\s*sizeFor,/,
      'the carry read for this request does not reach the reservation',
    );
    assert.match(
      handlePlan,
      /carryTokensFor\([\s\S]*?parsed\.value\.baseRevision/,
      'the carry is not read for the revision the caller is editing',
    );
  });

  it('runs on what it reserved, not on what it first asked for', () => {
    // The reservation may settle on the ordinary size. The Workflow is
    // given the ceiling and worst case from that result, or a run reserved
    // at the ordinary size would be sent with the larger ceiling and could
    // outspend its own reservation.
    assert.match(
      handlePlan,
      /\(\{\s*prices,\s*maxTokens\s*\}\s*=\s*sized\.ceiling\)/,
    );
    assert.match(handlePlan, /worstCase\s*=\s*sized\.worstCase/);
  });
});

describe('reserving for a follow-up the caller may not be able to afford', () => {
  const CARRIED = { maxTokens: 45_900, prices: {} as never };
  const ORDINARY = { maxTokens: 32_000, prices: {} as never };
  const sizeFor = (carry: number) =>
    carry > 0
      ? { ceiling: CARRIED, worstCase: 2_300_000 }
      : { ceiling: ORDINARY, worstCase: 1_600_000 };

  type Reserved =
    | { ok: true }
    | {
        ok: false;
        verdict: { reason: 'period-ceiling' | 'too-many-in-flight' };
      };

  function ledger(answers: Reserved[]) {
    const asked: number[] = [];
    return {
      asked,
      reserve: async (amount: number): Promise<Reserved> => {
        asked.push(amount);
        return answers[asked.length - 1] ?? { ok: true };
      },
    };
  }

  const broke: Reserved = { ok: false, verdict: { reason: 'period-ceiling' } };
  const busy: Reserved = {
    ok: false,
    verdict: { reason: 'too-many-in-flight' },
  };

  it('reserves the carried size when the caller can cover it', async () => {
    const { asked, reserve } = ledger([{ ok: true }]);
    const sized = await sizedReservation(40_000, sizeFor, reserve);

    assert.deepEqual(asked, [2_300_000]);
    assert.equal(sized.ceiling, CARRIED);
    assert.equal(sized.worstCase, 2_300_000);
  });

  it('falls back to the ordinary size rather than refusing', async () => {
    // Approved as room a caller gets when they can afford it. A caller who
    // cannot is no worse off than before internal issue 209: the ordinary reservation,
    // and the run gets to try.
    const { asked, reserve } = ledger([broke, { ok: true }]);
    const sized = await sizedReservation(40_000, sizeFor, reserve);

    assert.deepEqual(asked, [2_300_000, 1_600_000]);
    assert.equal(sized.reserved.ok, true);
    assert.equal(
      sized.ceiling,
      ORDINARY,
      'ran with a ceiling it did not reserve',
    );
    assert.equal(sized.worstCase, 1_600_000);
  });

  it('refuses only when the ordinary size is out of reach too', async () => {
    const { asked, reserve } = ledger([broke, broke]);
    const sized = await sizedReservation(40_000, sizeFor, reserve);

    assert.deepEqual(asked, [2_300_000, 1_600_000]);
    assert.equal(sized.reserved.ok, false);
  });

  it('does not ask again for less when the refusal was not about money', async () => {
    // A run already in flight is not solved by a smaller reservation, and
    // a second ask would only hold the ledger longer to say the same thing.
    const { asked, reserve } = ledger([busy]);
    const sized = await sizedReservation(40_000, sizeFor, reserve);

    assert.deepEqual(asked, [2_300_000]);
    assert.equal(sized.reserved, busy);
  });

  it('does not ask twice for a run that carried nothing', async () => {
    const { asked, reserve } = ledger([broke]);
    await sizedReservation(0, sizeFor, reserve);

    assert.deepEqual(asked, [1_600_000]);
  });
});
