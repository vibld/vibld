import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, metaFor } from '../site';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'credits-and-plans')!;
const CHECKED = '2026-09-16';

export function meta() {
  return metaFor('/docs/credits-and-plans');
}

export default function CreditsAndPlans() {
  return (
    <DocPage guide={GUIDE} updated={CHECKED}>
      <p>
        vibld bills for model spend, which is the thing that actually costs
        money to run. This page is what a plan includes, how a run is priced,
        and the order the layers are spent in.
      </p>

      <h2>The plans</h2>
      <ul>
        <li>
          <strong>Free</strong>: $1.00 of model spend per month.
        </li>
        <li>
          <strong>Build</strong>: $10.00 per month.
        </li>
        <li>
          <strong>Ship</strong>: $40.00 per month.
        </li>
      </ul>
      <p>
        An account with no active subscription is Free. The monthly allowance
        resets on the UTC calendar month, for everyone, rather than on each
        subscription’s own anniversary. That is a deliberate simplification: it
        is easier to reason about, at the cost of a first month that is shorter
        than thirty days.
      </p>
      <p>
        A new account is also granted <strong>$1.00 once</strong>, when it is
        created. That grant does not reset and is separate from the monthly
        allowance.
      </p>

      <h2>Top-up credit</h2>
      <p>
        Top-ups are one-time purchases and are not tied to a month. They are
        tried only when the monthly allowance is genuinely exhausted, not when
        it is merely low, so a top-up is a reserve rather than a substitute for
        the plan you are on. Top-up credit is available on any tier, Free
        included, and expires twelve months after purchase.
      </p>

      <h2>How a run is priced</h2>
      <p>
        A run <strong>reserves its worst case up front</strong> and is
        reconciled to what it actually cost once it finishes. That is why a long
        generation can briefly look more expensive than it turns out to be: the
        reservation is what stops a run starting that could not have been paid
        for, and the reconciliation is what you are actually charged.
      </p>
      <p>
        Prices follow the model that runs. A cheaper model reserves less and
        costs less, which is the practical reason the model selector exists.
      </p>

      <h2>The order things are spent in</h2>
      <p>Three ceilings apply to every run, in this order:</p>
      <ol>
        <li>
          A <strong>deployment-wide daily ceiling</strong>, across all accounts.
          It exists so that one compromised account cannot spend the month, and
          it is invisible in normal use.
        </li>
        <li>
          Your <strong>monthly tier allowance</strong>.
        </li>
        <li>
          Your <strong>top-up credit</strong>, once the allowance is gone.
        </li>
      </ol>
      <p>
        When a run is refused for spend, the reason names which ceiling it hit.
        The header readout is a read-only mirror of the same figures the gate
        uses, so what it shows and what it enforces cannot disagree.
      </p>

      <h2>Changing or cancelling</h2>
      <p>
        Upgrading starts a Stripe Checkout session. Once you have a Stripe
        customer record, <strong>Manage billing</strong> appears in the header
        and opens Stripe’s own billing portal, where cards, invoices and
        cancellation live.
      </p>
      <p>
        Refunds are covered by the <a href="/legal/refunds">Refund Policy</a>.
      </p>
    </DocPage>
  );
}
