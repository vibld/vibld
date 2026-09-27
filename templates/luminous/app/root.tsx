import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from 'react-router';

import type { Route } from './+types/root';
import { PageHead, SiteFooter, SiteHeader } from './components/SiteChrome';
import './app.css';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Tells the browser both themes exist before the stylesheet loads,
            so form controls and scrollbars match from the first paint. */}
        <meta name="color-scheme" content="light dark" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        {/* The body face is on every line of every page; fetching it early
            shortens the moment the fallback font is showing. */}
        <link
          rel="preload"
          href="/fonts/schibsted-grotesk-latin-wght-normal.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen antialiased">
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
    <PageHead
      kicker={notFound ? 'Error 404' : 'Error'}
      title={notFound ? 'Page not found' : 'Something went wrong'}
      lead={
        notFound
          ? 'That page does not exist. It may have moved, or the link may be out of date.'
          : 'The page could not be displayed. Reloading may help.'
      }
    >
      <p className="cta-row" style={{ justifyContent: 'flex-start' }}>
        <a href="/" className="btn btn-primary">
          Go to the home page
        </a>
      </p>
    </PageHead>
  );
}
