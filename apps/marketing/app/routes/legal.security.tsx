import { LegalPage } from '../components/SiteChrome';
import { LEGAL_DOCS, SITE, metaFor } from '../site';

const DOC = LEGAL_DOCS.find((d) => d.slug === 'security')!;
const UPDATED = '2026-09-10';

export function meta() {
  return metaFor('/legal/security');
}

export default function Security() {
  return (
    <LegalPage title={DOC.label} updated={UPDATED}>
      <p>
        We take reports of security vulnerabilities seriously and appreciate the
        work of good-faith security researchers. This page explains how to
        report a vulnerability and what protection you have for doing so
        responsibly.
      </p>

      <h2>How to report</h2>
      <p>
        Email{' '}
        <a href={`mailto:${SITE.emails.security}`}>{SITE.emails.security}</a>{' '}
        with a description of the issue, the steps to reproduce it, and its
        potential impact. Please encrypt sensitive reports if possible, and
        avoid including data that is not your own beyond what is necessary to
        demonstrate the issue. A machine-readable version of this contact
        information is published at{' '}
        <a href="/.well-known/security.txt">/.well-known/security.txt</a>, per
        RFC 9116.
      </p>

      <h2>What to expect</h2>
      <ul>
        <li>We will acknowledge a report within 3 business days.</li>
        <li>
          We will investigate and keep you reasonably informed of progress.
        </li>
        <li>
          We will let you know once the issue is resolved, and we welcome being
          credited unless you prefer otherwise.
        </li>
      </ul>

      <h2>Safe harbor</h2>
      <p>
        We will not pursue legal action against you for good-faith security
        research conducted in accordance with this policy, including testing,
        identifying, and reporting a vulnerability, provided that you:
      </p>
      <ul>
        <li>
          Avoid privacy violations, destruction of data, and interruption or
          degradation of the Service;
        </li>
        <li>
          Only interact with accounts and data you own or have explicit
          permission to access;
        </li>
        <li>
          Give us a reasonable time to investigate and remediate before
          disclosing the issue publicly; and
        </li>
        <li>
          Do not exploit a vulnerability beyond what is necessary to confirm it
          exists.
        </li>
      </ul>
      <p>
        This safe harbor does not extend to third-party services we use (see our{' '}
        <a href="/legal/subprocessors">Subprocessors</a> page). Report an issue
        in one of those directly to its own provider.
      </p>

      <h2>Scope</h2>
      <p>
        Today, this policy covers this website ({SITE.url}). Once the Vibld
        application and hosted previews launch, this page will be updated to
        describe their scope specifically, including how untrusted, AI-generated
        code is isolated.
      </p>
    </LegalPage>
  );
}
