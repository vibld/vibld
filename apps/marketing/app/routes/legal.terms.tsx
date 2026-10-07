import { LegalPage } from '../components/SiteChrome';
import { PLANS } from '../plan-sources.ts';
import { dollars, priceLabel } from '../plans.ts';
import { LEGAL_DOCS, SITE, metaFor } from '../site';

const DOC = LEGAL_DOCS.find((d) => d.slug === 'terms')!;
const UPDATED = SITE.legalEffectiveDate;

const BUILD = PLANS.plans.find((plan) => plan.id === 'build')!;
const SHIP = PLANS.plans.find((plan) => plan.id === 'ship')!;
const FREE = PLANS.plans.find((plan) => plan.id === 'free')!;

export function meta() {
  return metaFor('/legal/terms');
}

export default function Terms() {
  return (
    <LegalPage title={DOC.label} updated={UPDATED}>
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) are an agreement between
        you and {SITE.legalEntity} (&ldquo;{SITE.name}&rdquo;, &ldquo;we&rdquo;,
        &ldquo;us&rdquo;), a Georgia limited liability company with a mailing
        address of {SITE.mailingAddress}. They govern your use of this website,
        the builder at {SITE.appUrl}, previews and share links on{' '}
        <code>vibld-preview.dev</code>, and sites you publish there (together,
        the &ldquo;Service&rdquo;).
      </p>
      <p>
        By creating an account or using the Service you agree to these Terms,
        and to the <a href="/legal/acceptable-use">Acceptable Use Policy</a> and
        the <a href="/legal/refunds">Refund Policy</a>, which are part of them.
        If you do not agree, do not use the Service. These Terms and the
        Acceptable Use Policy cover the Service we host. They do not apply to
        anyone running vibld&apos;s open-source code on their own
        infrastructure.
      </p>

      <h2>1. The Service is a beta</h2>
      <p>
        vibld is in public beta. Anybody can sign up; no invitation is needed.
        You describe a site or an app, and vibld uses an AI model to write a
        specification and a React and TypeScript project, checks it, and lets
        you preview it, download it, push it to GitHub or publish it.
      </p>
      <p>
        Being a beta means features change, some are missing, and some will
        break. Keep your own copy of anything you cannot afford to lose: the
        builder lets you download your project as a .zip or push it to a GitHub
        repository at any time.
      </p>
      <p>
        There is no service-level agreement. The beta is provided &ldquo;as
        is&rdquo;: we use reasonable efforts to keep it available, and we post
        notice of significant outages on this website.
      </p>

      <h2>2. Who may use the Service</h2>
      <p>
        You must be at least 18 years old, or the age of majority where you live
        if that is higher. If you use the Service for an organization, you
        confirm you may bind it to these Terms.
      </p>
      <p>The Service is open to people anywhere in the world.</p>

      <h2>3. Your account</h2>
      <p>
        Accounts are provided through Clerk, which handles sign-up, sign-in and
        email verification for us. You are responsible for what happens under
        your account and for keeping your sign-in secure. Tell us at{' '}
        <a href={`mailto:${SITE.emails.security}`}>{SITE.emails.security}</a> if
        you think somebody else has used it. Today an account holds one project.
      </p>

      <h2>4. Plans, credit and payment</h2>
      <p>
        What you can spend on model runs is set by your plan. Prices are in US
        dollars:
      </p>
      <ul>
        <li>
          <strong>Free</strong>: no charge, and {dollars(FREE.monthlyCents)} of
          model spend each month once a card is saved through Stripe (the card
          is saved, not charged, and counts for the first account that saves
          it). Without a card, {dollars(PLANS.freeTrialCents)} of model spend
          once.
        </li>
        <li>
          <strong>Build</strong>: {priceLabel(BUILD.price!.monthly)} a month or{' '}
          {priceLabel(BUILD.price!.annual)} a year, with{' '}
          {dollars(BUILD.monthlyCents)} of model spend each month.
        </li>
        <li>
          <strong>Ship</strong>: {priceLabel(SHIP.price!.monthly)} a month or{' '}
          {priceLabel(SHIP.price!.annual)} a year, with{' '}
          {dollars(SHIP.monthlyCents)} of model spend each month, on the annual
          plan as on the monthly one.
        </li>
        <li>
          <strong>Top-up</strong>: {priceLabel(PLANS.topup.priceCents)}, one
          time, on any plan, adds {dollars(PLANS.topup.creditCents)} of model
          spend that expires twelve months after purchase.
        </li>
        <li>
          <strong>Welcome credit</strong>: an account created after the offer
          started can save a card through Stripe and receive{' '}
          {dollars(PLANS.signupCents)} of model spend once. The card is saved,
          not charged. The credit is given once per account and once per card,
          and expires twelve months after it is granted.
        </li>
      </ul>
      <p>
        Every run reserves its worst-case cost before it starts and is then
        charged at what it actually cost. Your monthly allowance resets on the
        first day of each calendar month in UTC, for every account, not on the
        anniversary of your subscription, so a first month can be shorter than a
        full month. Unused allowance does not carry over. Credit (top-ups, the
        welcome credit and referral rewards) is used only once the month&apos;s
        allowance is spent. Nothing is charged automatically past your
        allowance: when it and your credit are spent, runs stop until the month
        resets or you buy a top-up. We may also refuse runs for a time when a
        limit across all accounts is reached.
      </p>
      <p>
        Payments are taken by Stripe on pages it hosts; card details never reach
        us. Subscriptions renew automatically at the end of each month or year
        until you cancel them in the billing portal, reached from{' '}
        <strong>Manage billing</strong> in the builder. While a subscription is
        not active (canceled, past due or unpaid) the account has the Free
        allowance. Cancellations and refunds are covered by the{' '}
        <a href="/legal/refunds">Refund Policy</a>.
      </p>
      <p>
        Credit and allowances are measured in US dollars of model spend. They
        are not money, cannot be withdrawn or transferred, and have no value
        outside the Service. When an account is closed or deleted, its unused
        credit and allowance, whether paid for, free or from referrals, are
        forfeited, with no refund. We may change prices or what a plan includes.
        A price change applies to a subscription from its next renewal, and
        never to a period you have already paid for.
      </p>

      <h2>5. Referral credit</h2>
      <p>
        Your referral link is under <strong>Refer a friend</strong> in the
        builder&apos;s settings. If a new account arrives through it, claims it
        before starting any purchase (saving a card for the welcome credit does
        not count as one), and then makes its first payment, both accounts
        receive $5.00 of credit. A referral code cannot be your own, an account
        can be credited for at most 25 referrals, and a referral is attributed
        once and never changed. If the payment that earned the reward is
        refunded, or a dispute over it is lost, both rewards are taken back from
        granted credit, down to zero at most; purchased top-up credit is never
        reduced to do this.
      </p>

      <h2>6. Your content and the code vibld generates</h2>
      <p>
        &ldquo;Your content&rdquo; means what you put into the Service (prompts,
        standing instructions, the address of a reference page, images and video
        you upload) and the project files the Service generates for you. Our
        position on ownership and licensing of generated code is set out on the{' '}
        <a href="/legal/licenses">Open-Source Notices</a> page.
      </p>
      <p>
        You keep ownership of your content. You grant {SITE.legalEntity} a
        worldwide, non-exclusive, royalty-free license to host, store, process,
        build, preview and publish your content, and to send it to the provider
        of the model you choose (or of the default model), only for the purpose
        of running the Service for you. The license ends when your content is
        deleted, subject to backups and to the retention described in the{' '}
        <a href="/legal/privacy">Privacy Policy</a>.
      </p>
      <p>
        To produce a project, your content is sent to the model provider behind
        the model you choose; the <a href="/legal/privacy">Privacy Policy</a>{' '}
        says exactly what each one receives. When you give a reference address,
        vibld fetches that page from its own servers and passes its visible text
        to the model. Only give an address, upload a file or ask for material
        you have the right to use.
      </p>
      <p>
        AI output can be wrong, insecure, similar to other people&apos;s output,
        or include third-party open-source components under their own licenses.
        vibld checks what it builds, but those checks do not make the code fit
        for any purpose. Review and test it before you rely on it or put it in
        front of anyone else.
      </p>

      <h2>7. Previews, share links and published sites</h2>
      <p>
        A preview runs your project in an isolated container. It has a 30-minute
        lifetime and sleeps after 10 minutes without activity. It is private
        until you create a share link. Anyone holding a share link can see the
        running app and everything it shows until the link expires, the preview
        stops, or you revoke it.
      </p>
      <p>
        Publishing makes your project public at{' '}
        <code>&lt;name&gt;.vibld-preview.dev</code>, including any uploaded
        files it references. You are responsible for what you publish. You can
        take a site down from the builder, which removes its files; the name
        stays reserved to your account and is not given to anyone else. We may
        take a published site off the web without notice in response to a report
        or to protect people, the Service or the law, and only we can put it
        back. See the <a href="/legal/acceptable-use">Acceptable Use Policy</a>.
      </p>

      <h2>8. GitHub</h2>
      <p>
        If you connect a GitHub repository, you authorize vibld&apos;s GitHub
        App to create a branch, a commit and a pull request in that one
        repository when you push. The connection lasts 90 days or until you
        disconnect it. Your use of GitHub is governed by GitHub&apos;s own
        terms.
      </p>

      <h2>9. Acceptable use and ending access</h2>
      <p>
        You must follow the{' '}
        <a href="/legal/acceptable-use">Acceptable Use Policy</a>, which applies
        to the Service we host and the sites published through it. We may refuse
        runs, remove content, take down a published site, or suspend or close an
        account that breaks these Terms or the Acceptable Use Policy.
      </p>
      <p>
        Before we suspend or close an account, we email the address on it and
        give you 14 days to export your projects. We may act at once, without
        that notice, for serious or illegal abuse: for example, publishing
        malware, phishing or a scam, sexual content involving minors, or content
        that incites violence, or trying to break into the Service or other
        people&apos;s projects. If we close an account because it broke these
        Terms, nothing is refunded. If we close an account for any other reason,
        we refund the unused part of the period you paid for, prorated. Either
        way, the account&apos;s unused credit and allowance are forfeited, as
        section 4 says.
      </p>
      <p>
        You may stop using the Service at any time. Canceling a subscription is
        described in the <a href="/legal/refunds">Refund Policy</a>. You can
        also delete your account from the builder&apos;s settings, as the{' '}
        <a href="/legal/privacy">Privacy Policy</a> describes; deleting it
        cancels any subscription at once, with no refund of the period already
        paid for.
      </p>

      <h2>10. Intellectual property</h2>
      <p>
        The vibld name, logo, and this website&apos;s design and content are
        owned by {SITE.legalEntity} or its licensors. The vibld core software is
        separately licensed under the Apache License, Version 2.0; see our{' '}
        <a href="/legal/licenses">Open-Source Notices</a> page. Nothing here
        grants you rights to our trademarks.
      </p>

      <h2>11. Copyright complaints (DMCA)</h2>
      <p>
        If you believe content associated with the Service, including a
        published site, infringes your copyright, send a notice to{' '}
        <a href={`mailto:${SITE.emails.legal}`}>{SITE.emails.legal}</a> that
        identifies the copyrighted work, the material you claim is infringing
        and where it is located, your contact information, and a statement,
        under penalty of perjury, that you are authorized to act and that the
        information in your notice is accurate. Our designated agent is
        registered with the U.S. Copyright Office&apos;s DMCA Designated Agent
        Directory under registration number DMCA-1081350.
      </p>

      <h2>12. Disclaimers</h2>
      <p>
        The Service, including generated code, previews and published sites, is
        provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without
        warranties of any kind, express or implied, including warranties of
        merchantability, fitness for a particular purpose, and non-infringement,
        to the fullest extent permitted by law.
      </p>

      <h2>13. Limitation of liability and indemnity</h2>
      <p>
        To the fullest extent permitted by law, {SITE.legalEntity} will not be
        liable for any indirect, incidental, special, consequential, or punitive
        damages, or any loss of profits or data, arising from your use of, or
        inability to use, the Service. To the same extent, our total liability
        for all claims arising from these Terms or the Service is limited to the
        greater of the amount you paid {SITE.legalEntity} in the 12 months
        before the claim and US$100.
      </p>
      <p>
        You will indemnify {SITE.legalEntity} against any claim brought by a
        third party, and the losses, costs and reasonable legal fees that result
        from it, to the extent the claim arises from content you build, upload
        or publish through the Service, or from your breach of these Terms or
        the Acceptable Use Policy.
      </p>

      <h2>14. Governing law and venue</h2>
      <p>
        These Terms are governed by the laws of {SITE.governingLaw}, without
        regard to its conflict-of-laws rules. Any dispute arising from these
        Terms or the Service will be brought exclusively in the state or federal
        courts sitting in Gwinnett County, Georgia, and you consent to personal
        jurisdiction there.
      </p>

      <h2>15. Changes to these Terms</h2>
      <p>
        We may update these Terms as the Service changes. We will change the
        &ldquo;Last updated&rdquo; date above when we do, and for material
        changes we will email the address on your account at least 14 days
        before they take effect. Continuing to use the Service after a change
        takes effect means you accept it.
      </p>

      <h2>16. Contact</h2>
      <p>
        Questions about these Terms can be sent to{' '}
        <a href={`mailto:${SITE.emails.legal}`}>{SITE.emails.legal}</a>, to{' '}
        <a href={`mailto:${SITE.emails.hello}`}>{SITE.emails.hello}</a>, or to
        our mailing address above.
      </p>
    </LegalPage>
  );
}
