import { useEffect, useRef } from 'react';
import {
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
import { SiteFooter, SiteHeader } from './components/SiteChrome';
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
        <ScrollRestoration />
        <Scripts />
        <PageviewBeacon />
      </body>
    </html>
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
