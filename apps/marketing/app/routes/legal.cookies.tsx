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
        We set no cookies of our own, and we run no advertising or tracking
        scripts. We use no external fonts, and no social, video, or comment
        embeds.
      </p>
      <p>
        The site does load one third-party script, on every page: Cloudflare
        Turnstile, the anti-abuse check that sits on the waitlist form and
        establishes that a submission came from a person rather than a bot. It
        is served from <code>challenges.cloudflare.com</code>, so loading a page
        contacts Cloudflare, and Turnstile may store values in your browser as
        part of performing that check. Cloudflare states that it does not use
        Turnstile to track users across sites or to build advertising profiles.
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
        Cloudflare also hosts the site, and may set a small number of
        strictly-necessary cookies (for example, for security and abuse
        prevention) as part of delivering it. These are operational, not used to
        track you across sites, and are covered, along with Turnstile above, by{' '}
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
