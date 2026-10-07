import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, metaFor } from '../site';
import { FREE_PLAN } from '../plan-sources';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'credits-and-plans')!;
const CHECKED = '2026-10-07';

export function meta() {
  return metaFor('/docs/credits-and-plans');
}

export default function CreditsAndPlans() {
  return (
    <DocPage guide={GUIDE} updated={CHECKED}>
      <p>vibld bills for model spend, which is what costs money to run.</p>

      <h2>The plans</h2>
      <p>
        Each plan has two numbers, and they are different things: the price the
        subscription charges, and the model spend it includes every month.
      </p>
      <ul>
        <li>
          <strong>Free</strong>: no charge. Includes $1.00 of model spend per
          month once a card is saved, and $0.20 once to try it without one.
        </li>
        <li>
          <strong>Build</strong>: $19 a month, or $190 a year. Includes $14.00
          of model spend per month.
        </li>
        <li>
          <strong>Ship</strong>: $49 a month, or $490 a year. Includes $40.00 of
          model spend per month.
        </li>
      </ul>
      <p>
        Prices are in US dollars. A yearly plan includes the same model spend
        every month as the monthly one.
      </p>
      <p>
        A Free account builds, chats and sketches with {FREE_PLAN.models} only;
        the paid plans unlock the other models. It can have{' '}
        {FREE_PLAN.activeProjects} active projects at once (archived ones do not
        count), and Build and Ship have no limit.
      </p>
      <p>
        An account with no active subscription is Free. The monthly allowance
        resets on the UTC calendar month, for everyone, rather than on each
        subscription’s own anniversary, so a first month can be shorter than
        thirty days.
      </p>
      <p>
        A Free account starts with a <strong>$0.20 trial</strong>, about two
        builds, which does not reset. Saving a card moves it to the $1.00 a
        month: <strong>Plan and usage</strong> in the settings menu, and a note
        above the composer, offer it with an <strong>Add a card</strong> button,
        which opens a Stripe page that saves the card and charges nothing. A
        card counts for the first account that saves it, and an account that has
        paid for a plan or a top-up already has one on file.
      </p>
      <p>
        The one-time <strong>$1.00 welcome credit</strong> is no longer offered,
        from 7 October 2026. An account that received it keeps it, separate from
        the monthly allowance, until it expires twelve months after it was
        granted.
      </p>

      <h2>Top-up credit</h2>
      <p>
        A top-up costs $10 and adds $8.00 of model spend. Top-ups are one-time
        purchases and are not tied to a month. They are tried whenever what is
        left of the monthly allowance cannot hold a run’s reservation. A run is
        drawn from one or the other, never from both at once. Top-up credit is
        available on any tier, Free included, and expires twelve months after
        purchase.
      </p>

      <h2>How a run is priced</h2>
      <p>
        A run <strong>reserves its worst case up front</strong>, so no run
        starts that could not be paid for, and once it finishes you are charged
        what it actually cost. A long generation can briefly look more expensive
        than it turns out to be.
      </p>
      <p>
        Prices follow the model that runs. A cheaper model reserves less and
        costs less. Chat replies and the three sketches are priced the same way;
        the sketches cost about a tenth of a build.
      </p>
      <p>
        When you cannot fund a build’s full reservation, it is not refused
        outright: it is reserved what you have left and runs with a smaller
        budget, and if it runs out it stops and names the file it reached. Only
        below the least a build can run on is it refused.
      </p>
      <p>
        A build you cancel is charged for the steps it finished, plus the step
        that was running at the most it could have cost, and never more than it
        reserved. A build keeps running if you close the page.
      </p>

      <h2>The order things are spent in</h2>
      <p>Three ceilings apply to every run, in this order:</p>
      <ol>
        <li>
          A <strong>deployment-wide daily ceiling</strong>, across all accounts.
          It stops one compromised account spending the month, and is invisible
          in normal use.
        </li>
        <li>
          Your <strong>monthly tier allowance</strong>.
        </li>
        <li>
          Your <strong>top-up credit</strong>, when the allowance cannot hold
          the run.
        </li>
      </ol>
      <p>
        When a run is refused for spend, the reason names which ceiling it hit.
        For your own, it says how much is left and how much the run needs set
        aside. The readout under <strong>Plan and usage</strong> in the settings
        menu is a read-only mirror of the same figures the gate uses.
      </p>

      <h2>Changing or canceling</h2>
      <p>
        Upgrading starts a Stripe Checkout session. Once you have a Stripe
        customer record, <strong>Manage billing</strong> appears under{' '}
        <strong>Plan and usage</strong> in the settings menu and opens Stripe’s
        own billing portal, where cards and invoices live.
      </p>
      <p>
        <strong>Cancel plan</strong>, in the same place, opens Stripe’s page for
        canceling. A monthly plan is offered 50% off one month, once, before it
        cancels; a yearly plan is offered nothing.
      </p>

      <h2>Referrals</h2>
      <p>
        Your link is under <strong>Refer a friend</strong> in the settings menu,
        in the form <code>vibld.com/?ref=&lt;code&gt;</code>. When a friend
        signs up with it and makes their first payment, you each get $5.00 of
        build credit, for up to 25 friends.
      </p>
      <p>
        Refunds are covered by the <a href="/legal/refunds">Refund Policy</a>.
      </p>
    </DocPage>
  );
}
