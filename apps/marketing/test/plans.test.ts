import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { countWord, dollars, priceLabel, readPlans } from '../app/plans.ts';

/**
 * The pricing page's figures, held to the builder that enforces them and to
 * the decision that set them.
 *
 * `plans.ts` parses the text of three files in apps/web/worker, because they
 * cannot be imported into this app's type-check. A parser is a place for a
 * quiet mistake, so this imports the real allowance module at test time and
 * compares. The prices are Stripe's to charge; what is checked here is that
 * the figures beside the lookup keys are still the ones docs/decisions.md
 * records (L36, L38), so a price changed in one place and not the other
 * fails here instead of being printed.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');
const WORKER = join(ROOT, 'apps', 'web', 'worker');
const sources = {
  entitlement: readFileSync(join(WORKER, 'entitlement.ts'), 'utf8'),
  signupCredit: readFileSync(join(WORKER, 'signup-credit.ts'), 'utf8'),
  stripeClient: readFileSync(join(WORKER, 'stripe-client.ts'), 'utf8'),
  modelAccess: readFileSync(join(WORKER, 'model-access.ts'), 'utf8'),
};
const DECISIONS = readFileSync(join(ROOT, 'docs', 'decisions.md'), 'utf8');

/** A "$29"-style amount in decisions.md, in cents. */
function cents(text: string | undefined): number {
  assert.ok(text, 'docs/decisions.md no longer states this amount');
  return Math.round(Number(text) * 100);
}

/** One row of the "Values set" table: its two dollar amounts. */
function row(label: string): [number, number] {
  const match = new RegExp(
    `\\|\\s*${label}\\s*\\|\\s*\\$(\\d+(?:\\.\\d+)?)(?:/mo)?\\s*--\\s*\\$(\\d+(?:\\.\\d+)?)`,
  ).exec(DECISIONS);
  assert.ok(match, `docs/decisions.md has no "${label}" row`);
  return [cents(match[1]), cents(match[2])];
}

describe('the plans the pricing page states', () => {
  it('reads the same allowances the Worker enforces', async () => {
    // A variable specifier on purpose: the type-checker would otherwise
    // follow it into Workers types this app does not have.
    const path = join(WORKER, 'entitlement.ts');
    const worker = (await import(path)) as {
      TIER_INCLUDED_MICRO_USD: { build: number; ship: number };
      DEFAULT_FREE_INCLUDED_MICRO_USD: number;
    };
    const { plans } = readPlans(sources);
    const toCents = (micro: number) => micro / 10_000;
    assert.deepEqual(
      plans.map((plan) => [plan.id, plan.monthlyCents]),
      [
        ['free', toCents(worker.DEFAULT_FREE_INCLUDED_MICRO_USD)],
        ['build', toCents(worker.TIER_INCLUDED_MICRO_USD.build)],
        ['ship', toCents(worker.TIER_INCLUDED_MICRO_USD.ship)],
      ],
    );
  });

  it('reads the Free trial the Worker enforces (D159)', async () => {
    const path = join(WORKER, 'entitlement.ts');
    const worker = (await import(path)) as {
      DEFAULT_FREE_TRIAL_MICRO_USD: number;
    };
    assert.equal(
      readPlans(sources).freeTrialCents,
      worker.DEFAULT_FREE_TRIAL_MICRO_USD / 10_000,
    );
  });

  it('reads the new-account grant', () => {
    const declared = /DEFAULT_SIGNUP_CREDIT_USD_CENTS\s*=\s*(\d+)/.exec(
      sources.signupCredit,
    );
    assert.ok(declared, 'signup-credit.ts no longer declares the grant');
    assert.equal(readPlans(sources).signupCents, Number(declared[1]));
  });

  it('reads whether the grant waits for a card', () => {
    // Chris, 2026-09-27: the dollar is granted once a card is on file. The
    // copy states that condition from this flag, so the flag has to be read
    // from the Worker's own source rather than assumed.
    const declared = /SIGNUP_CREDIT_REQUIRES_CARD\s*=\s*(true|false)/.exec(
      sources.signupCredit,
    );
    assert.ok(
      declared,
      'signup-credit.ts no longer says whether a card is needed',
    );
    assert.equal(readPlans(sources).signupRequiresCard, declared[1] === 'true');
    assert.equal(readPlans(sources).signupRequiresCard, true);
  });

  it('prints the prices and allowances docs/decisions.md recorded', () => {
    const { plans, topup } = readPlans(sources);
    const byId = new Map(plans.map((plan) => [plan.id, plan]));

    const [freePrice, freeSpend] = row('Free tier');
    assert.equal(freePrice, 0);
    assert.equal(byId.get('free')!.price, null);
    assert.equal(byId.get('free')!.monthlyCents, freeSpend);

    for (const [id, label] of [
      ['build', 'Build tier'],
      ['ship', 'Ship tier'],
    ] as const) {
      const [monthly, spend] = row(label);
      assert.equal(byId.get(id)!.price?.monthly, monthly, `${id} monthly`);
      assert.equal(byId.get(id)!.monthlyCents, spend, `${id} included spend`);
    }

    // L38: "Annual billing at two months free -- Build $190, Ship $490 ..."
    const annual = /Annual billing[^|]*Build \$(\d+), Ship \$(\d+)/.exec(
      DECISIONS,
    );
    assert.ok(annual, 'docs/decisions.md no longer records annual prices');
    assert.equal(byId.get('build')!.price?.annual, cents(annual[1]));
    assert.equal(byId.get('ship')!.price?.annual, cents(annual[2]));

    const [topupPrice, topupSpend] = row('Top-up');
    assert.deepEqual(topup, {
      priceCents: topupPrice,
      creditCents: topupSpend,
    });
  });

  it('says what the guide says, figure for figure', () => {
    // The guide and the pricing page state the same plans. If the guide and
    // the builder disagree, the site must not quietly pick one.
    const guide = readFileSync(
      join(
        import.meta.dirname,
        '..',
        'app',
        'routes',
        'docs.credits-and-plans.tsx',
      ),
      'utf8',
    ).replace(/\s+/g, ' ');
    const { plans, signupCents, topup, freeTrialCents } = readPlans(sources);
    for (const plan of plans) {
      const price = plan.price
        ? `${priceLabel(plan.price.monthly)} a month, or ${priceLabel(plan.price.annual)} a year.`
        : 'no charge.';
      // D159: Free's month waits for a card, and a trial comes before it.
      const spend = plan.price
        ? `Includes ${dollars(plan.monthlyCents)} of model spend per month.`
        : `Includes ${dollars(plan.monthlyCents)} of model spend per month once a card is saved, and ${dollars(freeTrialCents)} once to try it without one.`;
      const expected = `<strong>${plan.name}</strong>: ${price} ${spend}`;
      assert.ok(
        guide.includes(expected),
        `the guide does not say: ${expected}`,
      );
    }
    assert.ok(guide.includes(`<strong>${dollars(signupCents)} once</strong>`));
    if (readPlans(sources).signupRequiresCard) {
      // The guide is what a customer is pointed to when they ask why their
      // dollar has not arrived, so it has to say what the builder waits for.
      assert.ok(guide.includes('by adding a card'));
      assert.ok(guide.includes('charges nothing'));
      assert.ok(guide.includes('once per account and once per card'));
    }
    assert.ok(
      guide.includes(
        `A top-up costs ${priceLabel(topup.priceCents)} and adds ${dollars(topup.creditCents)} of model spend.`,
      ),
    );
  });

  it('never presents an included allowance as a price', () => {
    // The mistake this replaces: "Build: $10.00 per month", where $10.00 is
    // the model spend and the price was $29.
    const guide = readFileSync(
      join(
        import.meta.dirname,
        '..',
        'app',
        'routes',
        'docs.credits-and-plans.tsx',
      ),
      'utf8',
    ).replace(/\s+/g, ' ');
    for (const plan of readPlans(sources).plans) {
      assert.doesNotMatch(
        guide,
        new RegExp(`\\$${(plan.monthlyCents / 100).toFixed(2)} per month\\.`),
      );
    }
  });

  it('refuses to guess when the source changes shape', () => {
    assert.throws(() =>
      readPlans({
        entitlement: 'nothing here',
        signupCredit: '',
        stripeClient: '',
        modelAccess: '',
      }),
    );
    assert.throws(() =>
      readPlans({ ...sources, stripeClient: 'export const X = 1;' }),
    );
    assert.throws(() =>
      readPlans({
        ...sources,
        signupCredit: sources.signupCredit.replace(
          /SIGNUP_CREDIT_REQUIRES_CARD/g,
          'SOMETHING_ELSE',
        ),
      }),
    );
  });
});

describe('the Free plan, as the pages state it (D98b)', () => {
  it("reads its models and its project limit from the builder's source", () => {
    const { free } = readPlans(sources);
    const models = /TIER_MODELS[\s\S]*?free:\s*\[([^\]]*)\]/.exec(
      sources.modelAccess,
    )?.[1];
    assert.ok(models, 'model-access.ts no longer declares the Free models');
    assert.deepEqual(
      free.modelIds,
      [...models.matchAll(/'([^']+)'/g)].map((match) => match[1]),
    );
    const limit = /ACTIVE_PROJECT_LIMIT[\s\S]*?free:\s*(\d+)/.exec(
      sources.entitlement,
    )?.[1];
    assert.equal(free.activeProjects, Number(limit));
  });

  it('refuses to build a page from a source it cannot read', () => {
    assert.throws(
      () => readPlans({ ...sources, modelAccess: '' }),
      /Free plan's models/,
    );
  });

  it('writes a small count as a word', () => {
    assert.equal(countWord(3), 'three');
    assert.equal(countWord(12), '12');
  });
});
