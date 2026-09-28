import { LegalPage } from '../components/SiteChrome';
import { LEGAL_DOCS, SITE, metaFor } from '../site';

const DOC = LEGAL_DOCS.find((d) => d.slug === 'security')!;
const UPDATED = SITE.legalEffectiveDate;

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
      <p>
        You can also report privately through GitHub, without a vibld account,
        at{' '}
        <a
          href={`${SITE.repoUrl}/security/advisories/new`}
          rel="noopener noreferrer"
        >
          github.com/vibld/vibld/security/advisories/new
        </a>
        . A draft advisory there is visible only to you and the maintainers.
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
      <p>This policy covers:</p>
      <ul>
        <li>this website ({SITE.url});</li>
        <li>the builder at {SITE.appUrl}, and the API behind it;</li>
        <li>
          previews, share links and published sites on{' '}
          <code>vibld-preview.dev</code>; and
        </li>
        <li>
          vibld&apos;s source code at{' '}
          <a href={SITE.repoUrl} rel="noopener noreferrer">
            github.com/vibld/vibld
          </a>
          .
        </li>
      </ul>
      <p>
        Projects that users generate, preview or publish are their own code and
        are not in scope, except where one of them can reach something it should
        not: another user&apos;s data, the builder, or vibld&apos;s credentials.
      </p>

      <h2>How generated code is isolated</h2>
      <p>
        vibld treats every generated project as untrusted. Previews and
        published sites are served from <code>vibld-preview.dev</code>, a
        separate domain from vibld.com, so they never share cookies with the
        builder. A preview runs in its own Cloudflare container that can reach
        only the public npm registry, holds no vibld or model-provider
        credential, and has a 30-minute lifetime. Share links are signed,
        expire, and can be revoked. Model-provider keys stay on our servers and
        never reach the browser. A report that any of these does not hold is
        exactly what we want to hear.
      </p>
    </LegalPage>
  );
}
