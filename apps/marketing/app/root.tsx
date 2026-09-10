import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from 'react-router';

import type { Route } from './+types/root';
import { SiteFooter, SiteHeader } from './components/SiteChrome';
import './app.css';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
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
      </body>
    </html>
  );
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
      <h1 className="text-4xl font-semibold tracking-tight">
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
