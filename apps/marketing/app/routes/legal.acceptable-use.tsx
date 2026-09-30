import { LegalPage } from '../components/SiteChrome';
import { LEGAL_DOCS, SITE, metaFor } from '../site';

const DOC = LEGAL_DOCS.find((d) => d.slug === 'acceptable-use')!;
const UPDATED = SITE.legalEffectiveDate;

export function meta() {
  return metaFor('/legal/acceptable-use');
}

export default function AcceptableUse() {
  return (
    <LegalPage title={DOC.label} updated={UPDATED}>
      <p>
        This policy describes what may and may not be built, uploaded, shared,
        published or sent through the vibld service that {SITE.legalEntity}{' '}
        hosts. It applies to this website ({SITE.url}), the builder at{' '}
        {SITE.appUrl}, previews and share links, sites published through the
        builder on <code>vibld-preview.dev</code>, and pushes to GitHub made
        from the builder, and it is part of our{' '}
        <a href="/legal/terms">Terms of Service</a>.
      </p>
      <p>
        It does not apply to anyone running vibld&apos;s open-source code
        themselves, on their own infrastructure. It covers only the service we
        host and what is published through it.
      </p>

      <h2>You may not use vibld to</h2>
      <ul>
        <li>
          Build, generate, upload, share or publish content that is illegal, or
          that infringes another person&apos;s intellectual property, privacy,
          or other rights. That includes using a reference page, or uploading
          images or video, that you do not have the right to use.
        </li>
        <li>
          Build or publish malware, phishing pages, pages that collect passwords
          or payment details under false pretenses, or tools designed to gain
          unauthorized access to systems or data.
        </li>
        <li>
          Impersonate a real person or organization in a way intended to
          deceive, including on a published site or a shared preview.
        </li>
        <li>
          Publish a site that contains or offers any of the following:
          <ul>
            <li>sexual content involving minors;</li>
            <li>pornography or sexually explicit material of any kind;</li>
            <li>
              content that incites violence, or that harasses or threatens a
              person;
            </li>
            <li>
              phishing, or impersonation of another person or brand, including
              collecting credentials under false pretenses;
            </li>
            <li>
              malware, fraud or scams, including crypto and get-rich-quick
              scams;
            </li>
            <li>the sale of illegal goods or services;</li>
            <li>material that infringes copyright or trademarks.</li>
          </ul>
        </li>
        <li>
          Send unsolicited bulk email, or otherwise abuse email-sending
          capability provided through the Service.
        </li>
        <li>
          Attempt to circumvent usage limits, spend ceilings, rate limits,
          security controls, or the isolation between your projects, previews
          and sites and anyone else&apos;s, including trying to reach the
          network or other systems from inside a preview.
        </li>
        <li>
          Create accounts, save cards or use referral links to collect welcome
          credit or referral rewards more than once, or for yourself.
        </li>
        <li>
          Probe, scan, or test the Service&apos;s security without our prior
          written permission, beyond what our{' '}
          <a href="/legal/security">Security & Vulnerability Disclosure</a>{' '}
          policy allows. See that policy for how to report a vulnerability.
        </li>
        <li>
          Use automated means to scrape this website or the builder, or to make
          requests at a volume meant to degrade the Service.
        </li>
      </ul>

      <h2>Enforcement</h2>
      <p>
        We may refuse runs, remove content, take a published site off the web,
        and suspend or close an account where we believe this policy or the law
        has been violated, and report conduct to law enforcement. A site we take
        down stops being served at once, its files are kept so the decision can
        be reviewed, and we record who took it down and why. Publishing again
        does not bring it back; only we can. We aim to be proportionate, and we
        will tell you why if we take action against your account, unless doing
        so would itself create a risk.
      </p>
      <p>
        To appeal a takedown or a suspension, email{' '}
        <a href={`mailto:${SITE.emails.abuse}`}>{SITE.emails.abuse}</a> and name
        the site or the account. A person reviews every appeal and replies
        within 14 days.
      </p>

      <h2>Reporting abuse</h2>
      <p>
        To report a published site, a shared preview, or other content or
        conduct that violates this policy, email{' '}
        <a href={`mailto:${SITE.emails.abuse}`}>{SITE.emails.abuse}</a> with its
        full address (for a published site,{' '}
        <code>&lt;name&gt;.vibld-preview.dev</code>) and what is wrong with it.
        Copyright complaints follow the DMCA process in our{' '}
        <a href="/legal/terms">Terms of Service</a>. Conduct in vibld&apos;s
        open-source project is covered by its Code of Conduct, with reports to{' '}
        <a href={`mailto:${SITE.emails.hello}`}>{SITE.emails.hello}</a>.
      </p>
    </LegalPage>
  );
}
