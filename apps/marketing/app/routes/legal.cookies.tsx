import { LegalPage } from '../components/SiteChrome';
import { LEGAL_DOCS, SITE, metaFor } from '../site';

const DOC = LEGAL_DOCS.find((d) => d.slug === 'cookies')!;
const UPDATED = SITE.legalEffectiveDate;

export function meta() {
  return metaFor('/legal/cookies');
}

export default function Cookies() {
  return (
    <LegalPage title={DOC.label} updated={UPDATED}>
      <p>
        This page describes what vibld stores in your browser: on this website,{' '}
        {SITE.url}; in the builder, {SITE.appUrl}; and on shared previews. It
        names every cookie and every browser storage key our own code sets.
      </p>

      <h2>This website</h2>
      <p>
        We run no advertising scripts. We use no external fonts, and no social,
        video, or comment embeds.
      </p>
      <p>
        <strong>Roadmap votes.</strong> The one cookie of our own on this site
        is set when you vote on the roadmap: a random voter id, so the site can
        tell your votes apart from everyone else&apos;s. It is first-party and
        HttpOnly, which means your browser sends it back to vibld.com and
        scripts on the page cannot read it. We keep only a SHA-256 hash of the
        id, not the id itself. The cookie is called{' '}
        <code>__Host-vibld_voter</code> and lasts 400 days from your latest
        vote. It is needed for voting to work, so it is not covered by the
        analytics question below, and nothing is set if you never vote.
      </p>
      <p>
        The site loads one third-party script on every page: Cloudflare
        Turnstile, the anti-abuse check that establishes that a request came
        from a person rather than a bot. It runs on the first roadmap vote from
        a browser. It is served from <code>challenges.cloudflare.com</code>, so
        loading a page contacts Cloudflare, and Turnstile may store values in
        your browser as part of performing that check. Cloudflare states that it
        does not use Turnstile to track users across sites or to build
        advertising profiles. The second is Google Analytics, described under
        page views below.
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
        advertising features, or any linking of this data to Google Ads, and our
        code tells Google Analytics that advertising storage, the use of your
        data for advertising, and ad personalisation are all refused. We use it
        to understand which pages people reach and what brought them here. How
        Google processes this data is covered by{' '}
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
        remembered in your browser&apos;s storage (under{' '}
        <code>vibld.consent.analytics</code>) rather than in a cookie, so it is
        not sent to us or to anyone else.
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
        If you arrive through a referral link, one ending in <code>?ref=</code>{' '}
        and a code, we keep that code in your browser&apos;s session storage for
        the rest of your visit and add it to our sign-up links, so an account
        you create is credited to the person who shared the link. It is not a
        cookie, and it is gone when you close the tab.
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

      <h2>The builder</h2>
      <p>
        Signing in is handled by Clerk, whose sign-in service for vibld runs at{' '}
        <code>clerk.vibld.com</code>. Clerk sets the cookies that keep you
        signed in. They are strictly necessary: without them you cannot stay
        signed in. Clerk&apos;s sign-up page also runs Cloudflare Turnstile. The
        builder runs no analytics. Clerk&apos;s cookies are:
      </p>
      <ul>
        <li>
          <code>__client</code>, on <code>clerk.vibld.com</code>: identifies
          your browser to Clerk and keeps you signed in, with a token that
          changes each time you sign in. It is HttpOnly. Clerk sets it to last
          ten years, and your browser may keep it for less.
        </li>
        <li>
          <code>__session</code>, on <code>app.vibld.com</code>: a signed token
          that shows the builder you are signed in. The token is valid for 60
          seconds and is replaced while the builder is open. Clerk&apos;s code
          in the page reads it, so it is not HttpOnly.
        </li>
        <li>
          <code>__client_uat</code>, on <code>vibld.com</code> and every address
          under it, so your browser also sends it to this website. It holds 0
          while you are signed out. Clerk sets it to last ten years, and scripts
          on the page can read it.
        </li>
        <li>
          Clerk also sets a copy of <code>__session</code> and of{' '}
          <code>__client_uat</code> under the same name followed by a short code
          (for example <code>__client_uat_VC93opp6</code>), and a{' '}
          <code>clerk_active_context</code> cookie on <code>app.vibld.com</code>{' '}
          that lasts until you close the browser.
        </li>
        <li>
          Cloudflare, in front of <code>clerk.vibld.com</code>, sets{' '}
          <code>__cf_bm</code>, for bot protection, which expires after 30
          minutes without activity, and <code>_cfuvid</code>, which tells apart
          visitors who share an IP address and lasts until you close the
          browser.
        </li>
      </ul>
      <p>
        The builder&apos;s own code sets no cookies. It keeps these in your
        browser&apos;s storage:
      </p>
      <ul>
        <li>
          <code>vibld.knowledge.v1</code>: your standing instructions, sent with
          each run.
        </li>
        <li>
          <code>vibld.styleDna.v1</code>: your saved style preferences, sent
          with each run.
        </li>
        <li>
          <code>vibld.theme</code>: whether you chose the light theme, the dark
          theme, or your system setting.
        </li>
        <li>
          <code>vibld.github.state</code>: a one-time value, kept only for the
          browser tab while you connect GitHub, that checks the connection came
          back to the browser that started it.
        </li>
      </ul>
      <p>
        Paying, saving a card and managing billing happen on pages Stripe hosts,
        which set Stripe&apos;s own cookies under{' '}
        <a href="https://stripe.com/privacy" rel="noopener noreferrer">
          Stripe&apos;s privacy policy
        </a>
        .
      </p>

      <h2>Shared previews and published sites</h2>
      <p>
        Opening a preview share link sets one cookie,{' '}
        <code>__Host-vibld_share</code>, on that share&apos;s own address under{' '}
        <code>vibld-preview.dev</code>. It carries the signed grant so the link
        keeps working as you move around the shared app, is HttpOnly, and
        expires when the share does. A published site or a running preview is
        the project&apos;s own code, and sets whatever cookies that code sets;
        vibld adds none to a published site.
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
