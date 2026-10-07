import { LegalPage } from '../components/SiteChrome';
import { PLANS } from '../plan-sources.ts';
import { dollars, priceLabel } from '../plans.ts';
import { LEGAL_DOCS, SITE, metaFor } from '../site';

const DOC = LEGAL_DOCS.find((d) => d.slug === 'refunds')!;
const UPDATED = SITE.legalEffectiveDate;

export function meta() {
  return metaFor('/legal/refunds');
}

export default function Refunds() {
  return (
    <LegalPage title={DOC.label} updated={UPDATED}>
      <p>
        This policy covers what you pay vibld for: Build and Ship subscriptions,
        monthly or annual, and one-time top-ups. Prices and what each includes
        are on the <a href="/pricing">pricing page</a> and in our{' '}
        <a href="/legal/terms">Terms of Service</a>. All payments are taken by
        Stripe.
      </p>

      <h2>No surprise charges</h2>
      <p>
        Usage stops at your plan&apos;s monthly allowance and any credit you
        hold; nothing is billed for going past it. More spend means buying a
        top-up yourself. Saving a card for the Free plan&apos;s monthly
        allowance charges nothing, so there is nothing to refund.
      </p>

      <h2>Canceling a subscription</h2>
      <p>
        Cancel at any time from <strong>Manage billing</strong> in the builder,
        which opens Stripe&apos;s billing portal. Canceling there takes effect
        at the end of the period you have already paid for, and your plan stays
        active until then. Once a subscription is no longer active, your account
        has the Free allowance. Unspent top-up credit stays usable until it
        expires, twelve months after purchase.
      </p>
      <p>
        Deleting your account cancels any subscription at once, with no refund
        of the period already paid for. When an account is closed or deleted,
        its unused credit and allowance, whether paid for, free or from
        referrals, are forfeited, with no refund.
      </p>

      <h2>Monthly plans</h2>
      <p>
        We do not prorate or refund the remainder of a month already paid for,
        except where the law requires.
      </p>

      <h2>Annual plans</h2>
      <p>
        You can cancel an annual plan at any time and get a prorated refund for
        the whole months of it left unused. To ask for one, email{' '}
        <a href={`mailto:${SITE.emails.billing}`}>{SITE.emails.billing}</a>.
        Canceling in the billing portal on its own stops the plan renewing at
        the end of the year, without a refund.
      </p>

      <h2>Top-ups</h2>
      <p>
        A top-up costs {priceLabel(PLANS.topup.priceCents)} and adds{' '}
        {dollars(PLANS.topup.creditCents)} of model spend. Top-ups are not
        refunded once bought, whether or not the credit has been used.
      </p>

      <h2>Errors and outages</h2>
      <p>
        If you are charged in error, or a sustained vibld outage prevented you
        from using a plan you paid for, email{' '}
        <a href={`mailto:${SITE.emails.billing}`}>{SITE.emails.billing}</a> and
        we will make it right.
      </p>

      <h2>How a refund is made</h2>
      <p>
        Refunds are issued by us through Stripe, to the payment method that
        paid. Nothing in the builder issues one automatically. When a payment is
        refunded, the credit, allowance or plan it bought is removed from your
        account automatically.
      </p>

      <h2>Disputes and chargebacks</h2>
      <p>
        Please email{' '}
        <a href={`mailto:${SITE.emails.billing}`}>{SITE.emails.billing}</a>{' '}
        before disputing a charge with your bank; we can usually settle it
        faster. If a dispute is decided against us, the credit, allowance or
        plan that payment bought is removed from your account automatically, as
        it is after a refund, and we may suspend the account until the matter is
        resolved.
      </p>

      <h2>Referral rewards</h2>
      <p>
        A referral reward is paid when the referred account&apos;s first payment
        clears. If that payment is refunded, or a dispute over it is lost, the
        reward is taken back from both accounts&apos; granted credit, down to
        zero at most; nobody is left owing money, and purchased top-up credit is
        never reduced for this. A refund of a different, later payment does not
        affect the reward.
      </p>
    </LegalPage>
  );
}
