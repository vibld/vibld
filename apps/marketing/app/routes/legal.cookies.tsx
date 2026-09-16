import { LegalPage } from '../components/SiteChrome';
import { LEGAL_DOCS, SITE, metaFor } from '../site';

const DOC = LEGAL_DOCS.find((d) => d.slug === 'cookies')!;
const UPDATED = '2026-09-16';

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
        We set no cookies of our own, and we run no advertising scripts. We use
        no external fonts, and no social, video, or comment embeds.
      </p>
      <p>
        The site loads one third-party script on every page: Cloudflare
        Turnstile, the anti-abuse check that sits on the waitlist form and
        establishes that a submission came from a person rather than a bot. It
        is served from <code>challenges.cloudflare.com</code>, so loading a page
        contacts Cloudflare, and Turnstile may store values in your browser as
        part of performing that check. Cloudflare states that it does not use
        Turnstile to track users across sites or to build advertising profiles.
        The second is Google Analytics, described under page views below.
      </p>
      <p>
        We count page views in two different ways, and only one of them needs
        your permission.
      </p>
      <p>
        The first is our own first-party measurement. Nothing about it
        identifies you: it sets no cookie, assigns no visitor or device
        identifier, and stores no IP address. For each page view we record only
        the page path, the <em>hostname</em> of the site that linked you here
        (never the full referring URL), any campaign tags in the link you
        followed, and the country your request came from. Those records are
        aggregate counts and cannot be traced back to a person or linked across
        visits.
      </p>
      <p>
        The second is Google Analytics 4,{' '}
        <strong>and it runs only if you say yes</strong>. It does not work the
        way the measurement above does, and we would rather say so plainly than
        bury it: Google Analytics sets cookies in your browser (names beginning{' '}
        <code>_ga</code>), assigns your browser a client identifier, and uses
        that identifier to recognise the same browser across pages and across
        visits. It also receives your IP address in order to derive an
        approximate location, though we have not enabled Google Signals,
        advertising features, or any linking of this data to Google Ads. We use
        it to understand which pages people reach and what brought them here.
        How Google processes this data is covered by{' '}
        <a
          href="https://policies.google.com/technologies/partner-sites"
          rel="noopener noreferrer"
        >
          Google&apos;s policy for sites that use its services
        </a>
        .
      </p>
      <p>
        The first time you visit, a banner asks whether Google Analytics may
        run. Until you answer, and if you answer no, we do not load it at all:
        no script is requested from Google, your browser does not contact Google
        on our behalf, and nothing is stored or measured. Saying yes loads it
        from that point on. You can change your answer at any time with the{' '}
        <strong>Cookie preferences</strong> link at the bottom of every page.
        Withdrawing stops it measuring at once, and normally reloads the page so
        the script is gone rather than merely switched off, with nothing loading
        on any page after that. In the rare case that your browser will not let
        us save the change, we stop it for the rest of the visit and say so on
        screen, rather than reloading into the old setting. Your answer is
        remembered in your browser rather than in a cookie, so it is not sent to
        us or to anyone else.
      </p>
      <p>
        Independently of that, browser tracking protection or an ad blocker will
        block the script, and Google publishes an{' '}
        <a
          href="https://tools.google.com/dlpage/gaoptout"
          rel="noopener noreferrer"
        >
          opt-out browser add-on
        </a>
        . Nothing on this site depends on any of it working.
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
        Once the vibld application launches, signing in will require an
        authentication cookie. We will update this page, and the &ldquo;Last
        updated&rdquo; date above, before that ships.
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
