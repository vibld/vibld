import { useEffect, useRef, useState } from 'react';
import {
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLocation,
} from 'react-router';

import type { Route } from './+types/root';
import { beaconFor } from './pageview.ts';
import {
  CONSENT_KEY,
  CONSENT_OPEN_EVENT,
  bannerVisible,
  consentSignals,
  readConsent,
  writeConsent,
  type ConsentChoice,
  type ConsentState,
} from './consent.ts';
import { SiteFooter, SiteHeader } from './components/SiteChrome';
import { SITE } from './site';
import './app.css';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <Meta />
        <Links />
        {/*
          Cloudflare Turnstile (docs/decisions.md L29). Loaded site-wide,
          async/defer so it never blocks rendering; WaitlistForm is the only
          page that currently renders a `.cf-turnstile` div for it to find.
        */}
        <script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          async
          defer
        ></script>
        <GoogleAnalytics />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <SiteHeader />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter />
        <ConsentBanner />
        <ScrollRestoration />
        <Scripts />
        <PageviewBeacon />
      </body>
    </html>
  );
}

/**
 * Google Analytics 4, loaded on every page.
 *
 * This is the standard gtag pair: the loader, then the inline bootstrap that
 * creates `dataLayer` and configures the property. It sits beside Turnstile in
 * the head rather than at the end of the body so the queue exists before
 * anything else on the page can push to it, and the loader is `async` so it
 * never blocks rendering.
 *
 * `send_page_view` is left on, so the `config` call counts the first view.
 * Every view after it is counted by GA4's own Enhanced Measurement, which
 * tracks page changes made through the History API and so already sees every
 * React Router navigation. Nothing here sends a second `page_view`: doing so
 * would double-count every internal link on the site. See `RouteChangeBeacon`
 * below, which is for our own counter only.
 *
 * Unlike worker/analytics.ts, this sets cookies and assigns a client
 * identifier, so it runs under Consent Mode and starts denied. Until the
 * visitor agrees, GA4 stores nothing in the browser and sends cookieless
 * pings; `ConsentBanner` is what changes that, and the footer's "Cookie
 * preferences" link is what changes it back.
 */
function GoogleAnalytics() {
  const id = SITE.ga4MeasurementId;
  // Consent is set before the property is configured, and denied is the
  // starting point rather than a correction applied later. Order is the whole
  // point: gtag applies the consent state in force when a command runs, so a
  // default that arrives after `config` arrives after the first hit has
  // already been sent under the wrong assumption.
  //
  // The stored answer is read here, synchronously, rather than waiting for
  // React. A returning visitor who already agreed would otherwise have their
  // first page of every visit measured without cookies and every page after
  // it with them, which is worse data than either answer alone. Every failure
  // path lands on denied: `localStorage` throws outright in a private window
  // or with site data blocked, and an unreadable store is not permission.
  const bootstrap = `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
var vibldConsent = 'denied';
try {
  var stored = window.localStorage.getItem('${CONSENT_KEY}');
  if (stored === 'granted') vibldConsent = 'granted';
} catch (e) {}
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: vibldConsent
});
gtag('js', new Date());
gtag('config', '${id}');`;
  return (
    <>
      <script
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${id}`}
      ></script>
      <script
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: bootstrap }}
      />
    </>
  );
}

/**
 * Records a pageview against our own `/api/hit`.
 *
 * Two halves, because this is a prerendered site that then behaves like an
 * application.
 *
 * The inline script covers the first view: dependency-free on purpose, it
 * runs before (and independently of) hydration, loads no third-party script,
 * sets no cookie, and sends no identifier -- see worker/analytics.ts for
 * exactly what is stored. `sendBeacon` is fire-and-forget and cannot delay or
 * fail the page, and it still fires if hydration never happens.
 *
 * The effect covers every view after it. The header, the footer and the legal
 * index all navigate with React Router `Link`, which replaces the page
 * without reloading the document, so an inline script rendered once in the
 * root layout never runs again. Left at that, every page reachable only by
 * an internal link -- which is all nine legal pages -- recorded nothing, and
 * the traffic report would have read as if nobody ever left the home page.
 */
function PageviewBeacon() {
  const script = `try{
  var d=new FormData();
  d.append('page_url',location.href);
  d.append('page_referrer',document.referrer);
  navigator.sendBeacon('/api/hit',d);
}catch(e){}`;
  return (
    <>
      <script
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: script }}
      />
      <RouteChangeBeacon />
    </>
  );
}

/**
 * Sends a pageview when the path changes, and never for the path the inline
 * script already sent.
 *
 * This counts for `/api/hit` only. GA4 needs no help here and must not be
 * given any: its Enhanced Measurement counts "page changes based on browser
 * history events" by default, React Router's `Link` navigates by
 * `history.pushState`, and an explicit `page_view` beside that would record
 * every internal navigation twice. The dependency runs the other way too, and
 * it is worth knowing: turning that setting off in the GA4 stream would leave
 * GA4 counting only the first view of a visit, which is the exact bug this
 * component exists to fix for our own counter.
 *
 * Keyed on the path rather than fired on every run, so the first effect after
 * hydration is a no-op and the view is counted once rather than twice. The
 * same comparison makes a repeated effect harmless, which matters because
 * React is free to run one more than once.
 *
 * The previous page is reported as the referrer rather than
 * `document.referrer`, which still names whatever brought the visitor to the
 * site. `referrerHost` in worker/analytics.ts resolves one of our own URLs to
 * "self", so internal navigation reads as internal instead of inventing a
 * referral from the original source for every page after the first.
 */
function RouteChangeBeacon() {
  const location = useLocation();
  const sent = useRef<string | null>(null);

  useEffect(() => {
    const here = `${location.pathname}${location.search}`;
    const decision = beaconFor(sent.current, here, window.location.origin);
    sent.current = here;
    if (!decision.send) return;
    try {
      const data = new FormData();
      data.append('page_url', window.location.href);
      data.append('page_referrer', decision.referrer);
      navigator.sendBeacon('/api/hit', data);
    } catch {
      // Same contract as the inline script: a lost datapoint never surfaces.
    }
  }, [location.pathname, location.search]);

  return null;
}

/**
 * Asks whether Google Analytics may store anything, and tells gtag the answer.
 *
 * Rendered for everyone and hidden by `bannerVisible`, rather than mounted
 * conditionally, so the footer link has something to reopen on every page.
 *
 * Nothing renders on the server. The stored answer lives in `localStorage`,
 * which a prerender cannot see, so a server-rendered banner would flash for
 * visitors who already answered and would be baked into the static HTML a
 * crawler reads. `decided` starting as `undefined` is what distinguishes
 * "not read yet" from "read, and nobody has answered".
 */
function ConsentBanner() {
  const [decided, setDecided] = useState<ConsentState | undefined>(undefined);
  const [reopened, setReopened] = useState(false);

  useEffect(() => {
    setDecided(readConsent(storage()));
    const open = () => setReopened(true);
    window.addEventListener(CONSENT_OPEN_EVENT, open);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, open);
  }, []);

  if (decided === undefined) return null;
  if (!bannerVisible(decided, reopened)) return null;

  const answer = (choice: ConsentChoice) => {
    writeConsent(storage(), choice);
    setDecided(choice);
    setReopened(false);
    // Told to gtag directly rather than by reloading the page. `update` is
    // how Consent Mode is meant to hear about a change mid-visit, and it
    // applies to the hits that follow without discarding the visit so far.
    try {
      const send = (
        window as unknown as { gtag?: (...args: unknown[]) => void }
      ).gtag;
      send?.('consent', 'update', consentSignals(choice));
    } catch {
      // A blocked or failed gtag means nothing was going to be stored anyway.
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Analytics cookies"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-black/10 bg-[var(--color-surface)] dark:border-white/10"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-5 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[var(--color-ink-muted)]">
          We count page views without cookies. May we also use Google Analytics,
          which sets cookies and recognises your browser across visits?{' '}
          <Link
            to="/legal/cookies"
            className="underline underline-offset-4 hover:text-[var(--color-ink)]"
          >
            Cookie Notice
          </Link>
        </p>
        <div className="flex shrink-0 gap-3">
          <button
            type="button"
            onClick={() => answer('denied')}
            className="rounded-md border border-black/15 px-4 py-2 font-medium dark:border-white/20"
          >
            No thanks
          </button>
          <button
            type="button"
            onClick={() => answer('granted')}
            className="rounded-md bg-[var(--color-accent)] px-4 py-2 font-medium text-[var(--color-accent-contrast)]"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * `localStorage` or nothing.
 *
 * The property access itself throws in a sandboxed frame and in some
 * privacy modes, which is why this is a function with a try around it rather
 * than a reference. Returning null puts every caller on the denied path.
 */
function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function App() {
  return <Outlet />;
}

/**
 * A static host serves this for any path that was not prerendered. It has to
 * be useful on its own: someone who followed a stale link is here, and a bare
 * "Error" tells them nothing about what to do next.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <article className="mx-auto max-w-5xl px-5 py-12">
      <h1 className="font-display text-4xl font-bold tracking-tight">
        {notFound ? 'Page not found' : 'Something went wrong'}
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-[var(--color-ink-muted)]">
        {notFound
          ? 'That page does not exist. It may have moved, or the link may be out of date.'
          : 'The page could not be displayed. Reloading may help.'}
      </p>
      <p className="mt-6">
        <a
          href="/"
          className="font-medium text-[var(--color-accent)] underline underline-offset-4"
        >
          Go to the home page
        </a>
      </p>
    </article>
  );
}
