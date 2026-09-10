import { LegalPage } from '../components/SiteChrome';
import { LEGAL_DOCS, SITE, metaFor } from '../site';

const DOC = LEGAL_DOCS.find((d) => d.slug === 'acceptable-use')!;
const UPDATED = '2026-09-10';

export function meta() {
  return metaFor('/legal/acceptable-use');
}

export default function AcceptableUse() {
  return (
    <LegalPage title={DOC.label} updated={UPDATED}>
      <p>
        This policy describes what may and may not be built, sent, or hosted
        through Vibld and this website. It applies to the waitlist today and
        will apply to the full product once it launches.
      </p>

      <h2>You may not use Vibld to</h2>
      <ul>
        <li>
          Build, generate, or host content that is illegal, or that infringes
          another person&apos;s intellectual property, privacy, or other rights.
        </li>
        <li>
          Generate malware, phishing pages, or tools designed to gain
          unauthorized access to systems or data.
        </li>
        <li>
          Impersonate a real person or organization in a way intended to
          deceive.
        </li>
        <li>
          Send unsolicited bulk email or otherwise abuse email-sending
          capability provided through the Service.
        </li>
        <li>
          Attempt to circumvent usage limits, security controls, or the
          isolation between your projects and anyone else&apos;s.
        </li>
        <li>
          Probe, scan, or test the Service&apos;s security without our prior
          written permission — see our{' '}
          <a href="/legal/security">Security & Vulnerability Disclosure</a>{' '}
          policy for how to report a vulnerability instead.
        </li>
        <li>
          Use automated means to scrape this website or submit the waitlist form
          at volume.
        </li>
      </ul>

      <h2>Enforcement</h2>
      <p>
        We may remove content, suspend or terminate access, and report conduct
        to law enforcement where we believe this policy or the law has been
        violated. We aim to be proportionate, and we will tell you why if we
        take action against your account, unless doing so would itself create a
        risk.
      </p>

      <h2>Reporting abuse</h2>
      <p>
        To report content or conduct that violates this policy, email{' '}
        <a href={`mailto:${SITE.emails.abuse}`}>{SITE.emails.abuse}</a> with as
        much detail as you can, including any relevant links or project
        identifiers.
      </p>
    </LegalPage>
  );
}
