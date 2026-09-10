import { LegalPage } from '../components/SiteChrome';
import { LEGAL_DOCS, SITE, metaFor } from '../site';

const DOC = LEGAL_DOCS.find((d) => d.slug === 'cookies')!;
const UPDATED = '2026-09-10';

export function meta() {
  return metaFor('/legal/cookies');
}

export default function Cookies() {
  return (
    <LegalPage title={DOC.label} updated={UPDATED}>
      <p>
        This page describes what this website actually stores in your browser
        today. It is short because the site itself is: a page, a waitlist form,
        and these legal documents.
      </p>

      <h2>What we use today</h2>
      <p>
        This site sets no cookies at all, and runs no advertising or third-party
        tracking scripts. We do not use Google Fonts or any other external font,
        script, or embed that would send your browser to a third party just by
        loading a page.
      </p>
      <p>
        We do count page views, using our own first-party measurement rather
        than a third-party analytics service. Nothing about it identifies you:
        it sets no cookie, assigns no visitor or device identifier, and stores
        no IP address. For each page view we record only the page path, the
        <em>hostname</em> of the site that linked you here (never the full
        referring URL), any campaign tags in the link you followed, and the
        country your request came from. Those records are aggregate counts and
        cannot be traced back to a person or linked across visits.
      </p>
      <p>
        Cloudflare, our hosting provider, may set a small number of
        strictly-necessary cookies (for example, for security and abuse
        prevention) as part of delivering the site. These are operational, not
        used to track you across sites, and are covered by{' '}
        <a
          href="https://www.cloudflare.com/privacypolicy/"
          rel="noopener noreferrer"
        >
          Cloudflare&apos;s privacy policy
        </a>
        .
      </p>

      <h2>What will change</h2>
      <p>
        Once the Vibld application launches, signing in will require an
        authentication cookie, and we may add privacy-respecting product
        analytics to understand how the builder is used. We will update this
        page, and the &ldquo;Last updated&rdquo; date above, before either of
        those ships.
      </p>

      <h2>Questions</h2>
      <p>
        Email{' '}
        <a href={`mailto:${SITE.emails.privacy}`}>{SITE.emails.privacy}</a> if
        you have questions about this notice.
      </p>
    </LegalPage>
  );
}
