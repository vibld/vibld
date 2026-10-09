import { Link } from 'react-router';

import { PlanCards, PlanFacts, SectionHead } from '../components/Sections';
import { PageHead } from '../components/SiteChrome';
import { PLANS } from '../plan-sources';
import { softwareApplicationSchema } from '../schema';
import { SITE, metaFor } from '../site';

export function meta() {
  return [...metaFor('/pricing'), softwareApplicationSchema(PLANS)];
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
        lead="Model spend is what costs money to run, so each plan includes some every month."
      />
      <section className="lb-section lb-section--tight" aria-label="The plans">
        <div className="lb-wrap">
          <PlanCards headingLevel={2} />
          <p className="lb-note">
            Prices are in US dollars and are charged through Stripe Checkout,
            which shows the total before anything is charged. Nothing is charged
            automatically past the allowance unless you turn it on: auto-reload
            buys a $10 top-up on your saved card when less than $1 is left, up
            to a monthly cap you choose, and Start Build moves a Free account to
            Build once when less than $1 is left. A build you cannot fully fund
            is started smaller rather than refused, and once too little is left
            for even that, runs are refused until the month resets or you buy a
            top-up.
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
                A run reserves its worst case before it starts, so no run starts
                that could not be paid for. A long generation can briefly look
                more expensive than it turns out to be.
              </p>
            </article>
            <article className="lb-card">
              <h3>The reconciliation</h3>
              <p>
                When the run finishes it is reconciled to what it actually cost,
                and that is what you are charged. Prices follow the model that
                runs: a cheaper model reserves less and costs less.
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
            lede="When a run is refused for spend, the reason names which ceiling it hit and, for your own, how much is left against how much the run needs."
          />
          <ol className="lb-ceilings">
            <li>
              <h3>A deployment-wide daily ceiling</h3>
              <p>
                Across all accounts, so that one compromised account cannot
                spend the month. Invisible in normal use. Free runs also share
                their own part of it, so free use takes at most that part and
                the rest stays for paying accounts; runs paid from top-up credit
                do not count as free use.
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
                Tried whenever what is left of the allowance cannot hold a run’s
                reservation, and a run is drawn from one or the other, never
                both. Top-ups are one-time purchases on any plan, Free included,
                and expire twelve months after purchase.
              </p>
            </li>
          </ol>
        </div>
      </section>

      <section className="lb-section" aria-labelledby="change-title">
        <div className="lb-wrap">
          <SectionHead
            eyebrow="Changing or canceling"
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
                Stripe’s own billing portal, where cards and invoices live.
                Cancel plan, beside it, offers a monthly plan 50% off one month,
                once, before it cancels; a yearly plan is offered nothing.
                Refunds are covered by the{' '}
                <Link className="lb-link" to="/legal/refunds">
                  Refund Policy
                </Link>
                .
              </p>
            </article>
          </div>
          <p className="lb-after__cta">
            <a className="button" href={SITE.signUpUrl}>
              Sign up
            </a>
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
