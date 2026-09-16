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
  CONSENT_CHANGED_EVENT,
  CONSENT_OPEN_EVENT,
  GA4_SRC,
  analyticsAction,
  recordAnswer,
  bannerVisible,
  consentSignals,
  isConsentStorageEvent,
  mustReload,
  readConsent,
  type ConsentChange,
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
      </head>
      <body className="min-h-screen font-sans antialiased">
        <SiteHeader />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter />
        <GoogleAnalytics />
        <ConsentBanner />
        <ScrollRestoration />
        <Scripts />
        <PageviewBeacon />
      </body>
    </html>
  );
}

/**
 * Google Analytics 4, loaded only once the visitor has agreed.
 *
 * The first version of this rendered the tag into every page's head and used
 * Consent Mode to withhold storage. Codex was right that the Cookie Notice
 * then said something untrue: under denied consent gtag.js is still fetched
 * from Google and still sends cookieless pings, so "it runs only if you say
 * yes" would have been wrong, and an approximately true privacy notice is
 * not worth writing.
 *
 * So nothing is requested from Google until `shouldLoadAnalytics` says so.
 * Undecided and denied behave identically, because a visitor who has not
 * been asked has not agreed.
 *
 * The tag is a rendered element that does not exist until then, rather than
 * one built with `document.createElement` and appended. Both load exactly
 * the same URL, but hand-injecting a script is the shape of a real
 * vulnerability and CodeQL rightly does not care that this particular URL is
 * a constant. React 19 hoists an `async` script to the head and runs it, so
 * the declarative version is not a workaround for the scanner; it is the
 * same thing said in a way that cannot be turned into an injection by a
 * later edit. Nothing is server-rendered, because `allowed` starts false and
 * only an effect can turn it on.
 *
 * Consent is declared before `config` even here, where the tag only ever
 * exists in the granted state, because gtag applies the state in force when
 * a command runs and the advertising signals still have to be denied.
 *
 * `send_page_view` is left on, so the `config` call counts the first view.
 * Every view after it is counted by GA4's own Enhanced Measurement, which
 * tracks page changes made through the History API and so already sees every
 * React Router navigation. Nothing here sends a second `page_view`: doing so
 * would double-count every internal link on the site. See `RouteChangeBeacon`
 * below, which is for our own counter only.
 */
function GoogleAnalytics() {
  const [allowed, setAllowed] = useState(false);
  // What the tag is doing, readable from inside the effect's one closure.
  // State cannot answer that here: the listener is registered once and would
  // keep whatever `allowed` was when it was created.
  const running = useRef(false);

  useEffect(() => {
    const apply = (state: ConsentState, allowReload = true) => {
      // Every branch is `analyticsAction`'s, and it is tested. Deciding this
      // inline is what produced two review findings: a withdrawal that never
      // reached gtag, and a second grant skipped because the tag was already
      // loaded.
      const action = analyticsAction(state, running.current);
      switch (action) {
        case 'load': {
          running.current = true;
          // Queued before the script exists, which is how gtag is meant to be
          // used: `dataLayer` is a plain array until gtag.js replaces it, and
          // everything pushed beforehand is replayed in order. Consent is
          // declared ahead of `config` even here, where the tag only ever
          // loads in the granted state, because the advertising signals still
          // have to be denied before anything is sent.
          const queue = window as unknown as { dataLayer?: unknown[] };
          queue.dataLayer = queue.dataLayer ?? [];
          tell('consent', 'default', consentSignals('granted'));
          tell('js', new Date());
          tell('config', SITE.ga4MeasurementId);
          setAllowed(true);
          break;
        }
        case 'grant':
          tell('consent', 'update', consentSignals('granted'));
          break;
        case 'deny':
          // Both halves, in this order. The update stops storage in the
          // document that is already running, and the reload is what makes
          // the tag actually gone: this is a single-page app, so internal
          // links never create a new document, and an update on its own
          // leaves Enhanced Measurement sending cookieless hits to Google
          // for the rest of the visit. The Cookie Notice says withdrawal
          // takes effect immediately, and without the reload that was not
          // true.
          //
          // It cannot loop: the answer is stored before this runs, so the
          // next document reads denied, loads nothing, and never reaches
          // this branch.
          tell('consent', 'update', consentSignals('denied'));
          break;
        case 'nothing':
          break;
      }

      // `allowReload` is false only when the answer could not be written and
      // the store still holds a grant. Reloading then would read that grant
      // and load analytics again, so a click on "No thanks" would turn it
      // back on. The tag stays in this document, denied, and the banner says
      // why.
      if (allowReload && mustReload(action)) window.location.reload();
    };

    apply(readConsent(storage()));

    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<ConsentChange>).detail;
      apply(detail?.state ?? null, detail?.allowReload ?? true);
    };
    // The same answer arriving from another tab. A `storage` event fires in
    // every other document on this origin and never in the one that wrote,
    // so this and the custom event above are two halves of one thing rather
    // than a duplicate: without it, a second tab keeps running the tag it
    // loaded earlier and goes on sending hits after the visitor has said no.
    const onStored = (event: StorageEvent) => {
      if (!isConsentStorageEvent(event.key)) return;
      apply(readConsent(storage()));
    };
    window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
    window.addEventListener('storage', onStored);
    return () => {
      window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
      window.removeEventListener('storage', onStored);
    };
  }, []);

  if (!allowed) return null;
  return <script async src={`${GA4_SRC}${SITE.ga4MeasurementId}`} />;
}

/**
 * Push onto gtag's queue.
 *
 * `dataLayer.push(arguments)` is what the official snippet's `gtag` does, and
 * doing it directly avoids defining a global function that only this file
 * calls. Guarded because a blocked script, a sandboxed frame or a missing
 * `window` must never throw out of an effect.
 */
function tell(...args: unknown[]) {
  try {
    const queue = (window as unknown as { dataLayer?: unknown[] }).dataLayer;
    queue?.push(args);
  } catch {
    // Nothing was going to be measured anyway.
  }
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
  // A "yes" we could not write down. Shown instead of the banner's question,
  // because closing silently would claim we had remembered something we had
  // not, and the visitor would be asked again next page with no explanation.
  // Which answer could not be written down, or null when all is well. The
  // two failures need different sentences: a lost yes costs the visitor a
  // repeated question, and a lost no means analytics comes back when they
  // reload.
  const [unsaved, setUnsaved] = useState<ConsentChoice | null>(null);

  useEffect(() => {
    setDecided(readConsent(storage()));
    const open = () => setReopened(true);
    // Answered in another tab. Without this the banner here goes on asking a
    // question that has been answered, and a second answer would overwrite
    // the first for no reason the visitor could see.
    const onStored = (event: StorageEvent) => {
      if (!isConsentStorageEvent(event.key)) return;
      setDecided(readConsent(storage()));
      setReopened(false);
      setUnsaved(null);
    };
    window.addEventListener(CONSENT_OPEN_EVENT, open);
    window.addEventListener('storage', onStored);
    return () => {
      window.removeEventListener(CONSENT_OPEN_EVENT, open);
      window.removeEventListener('storage', onStored);
    };
  }, []);

  if (decided === undefined) return null;
  if (unsaved === null && !bannerVisible(decided, reopened)) return null;

  const answer = (choice: ConsentChoice) => {
    const outcome = recordAnswer(storage(), choice);
    setDecided(outcome.apply);
    setReopened(false);
    setUnsaved(outcome.warn ? outcome.apply : null);
    // `GoogleAnalytics` is what acts on this: it loads the tag on a grant and
    // stops storage on a withdrawal. The banner decides, and says so; it does
    // not reach into gtag itself.
    window.dispatchEvent(
      new CustomEvent<ConsentChange>(CONSENT_CHANGED_EVENT, {
        detail: { state: outcome.apply, allowReload: outcome.safeToReload },
      }),
    );
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
          {unsaved === 'granted' ? (
            <>
              Google Analytics is on for this visit, but your browser would not
              let us save that choice, so we will have to ask again next time.
            </>
          ) : unsaved === 'denied' ? (
            <>
              Google Analytics is off for the rest of this visit, but your
              browser would not let us change the saved setting, so it will come
              back if you reload. Clearing this site&apos;s data in your browser
              will remove it for good.
            </>
          ) : (
            <>
              We count page views without cookies. May we also use Google
              Analytics, which sets cookies and recognises your browser across
              visits?{' '}
              <Link
                to="/legal/cookies"
                className="underline underline-offset-4 hover:text-[var(--color-ink)]"
              >
                Cookie Notice
              </Link>
            </>
          )}
        </p>
        <div className="flex shrink-0 gap-3">
          {unsaved !== null ? (
            // Nothing left to decide: the answer is already applied and the
            // only thing this button does is acknowledge that it will not be
            // remembered. Offering the same two choices again would invite a
            // second click that fails exactly as the first one did.
            <button
              type="button"
              onClick={() => setUnsaved(null)}
              className="rounded-md border border-black/15 px-4 py-2 font-medium dark:border-white/20"
            >
              Got it
            </button>
          ) : (
            <>
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
            </>
          )}
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
