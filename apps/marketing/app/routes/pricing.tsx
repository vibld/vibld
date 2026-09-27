import { Link } from 'react-router';

import { PlanCards, PlanFacts, SectionHead } from '../components/Sections';
import { PageHead } from '../components/SiteChrome';
import { SITE, metaFor } from '../site';

export function meta() {
  return metaFor('/pricing');
}

/**
 * The plans, with their prices (Chris, 2026-09-27: "Publish the real
 * prices") and the model spend each includes, as the Credits and plans guide
 * states them.
 *
 * Every figure is read from the builder's source (`plans.ts`): the included
 * spend from what the spend gate enforces, the prices from beside the Stripe
 * lookup keys. `test/plans.test.ts` holds the prices to the price table in
 * docs/decisions.md, so this page, the guide, the Worker and the decision
 * cannot come to disagree without a test saying so.
 */
export default function Pricing() {
  return (
    <>
      <PageHead
        eyebrow="Pricing"
        title="A price, and the model spend it includes"
        lead="Model spend is what actually costs money to run, so each plan comes with an amount of it every month. An account with no active subscription is Free."
      />
      <section className="lb-section lb-section--tight" aria-label="The plans">
        <div className="lb-wrap">
          <PlanCards headingLevel={2} />
          <p className="lb-note">
            Prices are in US dollars and are charged through Stripe Checkout,
            which shows the total before anything is charged. Nothing is charged
            automatically past the allowance: once it and any top-up credit are
            spent, runs are refused until the month resets or you buy a top-up.
            vibld is invite-only for now.
          </p>
          <PlanFacts />
        </div>
      </section>

      <section className="lb-section" aria-labelledby="run-title">
        <div className="lb-wrap">
          <SectionHead
            eyebrow="How a run is priced"
            id="run-title"
            title="Reserved up front, charged for what it cost"
          />
          <div className="lb-grid2">
            <article className="lb-card">
              <h3>The reservation</h3>
              <p>
                A run reserves its worst case before it starts, which is what
                stops a run starting that could not have been paid for. That is
                why a long generation can briefly look more expensive than it
                turns out to be.
              </p>
            </article>
            <article className="lb-card">
              <h3>The reconciliation</h3>
              <p>
                When the run finishes it is reconciled to what it actually cost,
                and that is what you are charged. Prices follow the model that
                runs: a cheaper model reserves less and costs less, which is the
                practical reason the model selector exists.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="lb-section" aria-labelledby="order-title">
        <div className="lb-wrap">
          <SectionHead
            eyebrow="The order things are spent in"
            id="order-title"
            title="Three ceilings, in this order"
            lede="When a run is refused for spend, the reason names which ceiling it hit."
          />
          <ol className="lb-ceilings">
            <li>
              <h3>A deployment-wide daily ceiling</h3>
              <p>
                Across all accounts, so that one compromised account cannot
                spend the month. Invisible in normal use.
              </p>
            </li>
            <li>
              <h3>Your monthly plan allowance</h3>
              <p>
                It resets on the UTC calendar month for everyone, rather than on
                each subscription’s anniversary: easier to reason about, at the
                cost of a first month shorter than thirty days.
              </p>
            </li>
            <li>
              <h3>Your top-up credit</h3>
              <p>
                Tried only once the allowance is genuinely exhausted, not merely
                low. Top-ups are one-time purchases on any plan, Free included,
                and expire twelve months after purchase.
              </p>
            </li>
          </ol>
        </div>
      </section>

      <section className="lb-section" aria-labelledby="change-title">
        <div className="lb-wrap">
          <SectionHead
            eyebrow="Changing or cancelling"
            id="change-title"
            title="Stripe handles the money"
          />
          <div className="lb-grid2">
            <article className="lb-card">
              <h3>Upgrading</h3>
              <p>
                Starts a Stripe Checkout session. Plan and usage in the settings
                menu is a read-only mirror of the figures the spend gate uses.
              </p>
            </article>
            <article className="lb-card">
              <h3>Billing and cancellation</h3>
              <p>
                Once you have a Stripe customer record, Manage billing opens
                Stripe’s own billing portal, where cards, invoices and
                cancellation live. Refunds are covered by the{' '}
                <Link className="lb-link" to="/legal/refunds">
                  Refund Policy
                </Link>
                .
              </p>
            </article>
          </div>
          <p className="lb-after__cta">
            <Link className="button" to="/#waitlist">
              Join the waitlist
            </Link>
            <a className="lb-link" href={SITE.appUrl}>
              Sign in
            </a>
            <Link className="lb-link" to="/docs/credits-and-plans">
              Credits and plans, the guide
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
