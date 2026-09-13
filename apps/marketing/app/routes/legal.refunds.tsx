import { LegalPage } from '../components/SiteChrome';
import { LEGAL_DOCS, SITE, metaFor } from '../site';

const DOC = LEGAL_DOCS.find((d) => d.slug === 'refunds')!;
const UPDATED = '2026-09-10';

export function meta() {
  return metaFor('/legal/refunds');
}

export default function Refunds() {
  return (
    <LegalPage title={DOC.label} updated={UPDATED}>
      <p>
        Vibld does not yet have paid plans, so nothing on this page applies
        today. Joining the waitlist never involves a payment. This policy is
        published in advance of billing so its terms are set before anyone is
        charged, not adjusted afterward.
      </p>

      <h2>How billing will work</h2>
      <p>
        When paid plans launch, Vibld&apos;s subscriptions are structured to
        avoid surprise charges: usage stops at your plan&apos;s included
        allowance rather than billing overage automatically, and any additional
        spend requires you to actively purchase a top-up.
      </p>

      <h2>Monthly plans</h2>
      <p>
        You may cancel a monthly subscription at any time; cancellation takes
        effect at the end of the current billing period, and we do not prorate
        or refund the remainder of a period already paid for, except where
        required by law.
      </p>

      <h2>Annual plans</h2>
      <p>
        Annual plans are billed once for the year. If you cancel within 14 days
        of an annual purchase and have not substantially used the included
        allowance, contact{' '}
        <a href={`mailto:${SITE.emails.billing}`}>{SITE.emails.billing}</a> for
        a full refund. After 14 days, annual plans are non-refundable except
        where required by law, though you may cancel to stop renewal.
      </p>

      <h2>Errors and outages</h2>
      <p>
        If you are charged in error, or a sustained Vibld outage prevented you
        from using a plan you paid for, email{' '}
        <a href={`mailto:${SITE.emails.billing}`}>{SITE.emails.billing}</a> and
        we will make it right.
      </p>

      <h2>This page will be finalized before checkout exists</h2>
      <p>
        This policy is a commitment for how billing will work, published ahead
        of the feature itself. We will confirm and, if needed, expand it before
        the first payment is ever collected, not after.
      </p>
    </LegalPage>
  );
}
