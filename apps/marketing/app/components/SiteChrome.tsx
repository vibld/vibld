import { Link } from 'react-router';
import { CONSENT_OPEN_EVENT } from '../consent.ts';
import { Lockup } from './Mark.tsx';
import { DOC_TRACKS, LEGAL_DOCS, SITE } from '../site';

/**
 * The skip link is the first thing in the tab order on every page. Without it
 * a keyboard user walks the whole header again on each page they visit.
 */
export function SiteHeader() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-md focus:bg-[var(--color-accent)] focus:px-4 focus:py-2 focus:text-[var(--color-on-accent)]"
      >
        Skip to main content
      </a>
      <header className="border-b border-black/10 dark:border-white/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
          <Link to="/" className="flex items-center gap-2.5">
            <Lockup />
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-[var(--color-ink-muted)] sm:inline">
              {SITE.tagline}
            </span>
            {/*
              The other answer to "what does this actually do", and the one
              that does not need reading. /styles was prerendered, listed in
              the sitemap, and linked from the builder's style legend
              (#192), so the only people who could reach it were the people
              who had already signed in and already knew. A crawler could
              find it and a visitor could not.
            */}
            <Link
              to="/styles"
              className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium hover:underline hover:underline-offset-4"
            >
              Styles
            </Link>
            {/*
              In the header rather than the footer only. The guides answer
              "what does this actually do", which is a question somebody has
              before they sign up, not after.
            */}
            <Link
              to="/docs"
              className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium hover:underline hover:underline-offset-4"
            >
              Docs
            </Link>
            {/*
              A plain anchor: app.vibld.com is a different Worker on a
              different host, so routing to it client-side would 404 in the
              router before the browser ever left this origin.
            */}
            <a
              href={SITE.appUrl}
              className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-[var(--color-accent-ink)] hover:underline hover:underline-offset-4"
            >
              Sign in
            </a>
          </div>
        </div>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-black/10 dark:border-white/10">
      <div className="mx-auto max-w-5xl px-5 py-10 text-sm text-[var(--color-ink-muted)]">
        {/*
          The two tracks, not all nine guides. The index is the navigation;
          a footer that lists every page is a second, worse copy of it.
        */}
        <nav aria-label="Guides" className="mb-6">
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {DOC_TRACKS.map((track) => (
              <li key={track.id}>
                <Link
                  to={`/docs#${track.id}`}
                  className="hover:text-[var(--color-ink)] hover:underline hover:underline-offset-4"
                >
                  {track.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Legal">
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {LEGAL_DOCS.map((doc) => (
              <li key={doc.slug}>
                <Link
                  to={`/legal/${doc.slug}`}
                  className="hover:text-[var(--color-ink)] hover:underline hover:underline-offset-4"
                >
                  {doc.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="mt-4">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))}
            className="underline underline-offset-4 hover:text-[var(--color-ink)]"
          >
            Cookie preferences
          </button>
        </p>
        <p className="mt-6">
          © {new Date().getFullYear()} {SITE.legalEntity}. {SITE.mailingAddress}
          .
        </p>
        <p className="mt-1">
          <a
            href={`mailto:${SITE.emails.support}`}
            className="hover:text-[var(--color-ink)] hover:underline hover:underline-offset-4"
          >
            {SITE.emails.support}
          </a>
        </p>
      </div>
    </footer>
  );
}

export function Page({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow?: string;
  title: string;
  lead: string;
  children?: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-5xl px-5 py-16">
      {eyebrow ? (
        <p className="font-mono text-sm font-medium tracking-wide text-[var(--color-accent-ink)] uppercase">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-balance sm:text-5xl">
        {title}
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-[var(--color-ink-muted)] text-pretty">
        {lead}
      </p>
      {children}
    </article>
  );
}

/**
 * Shared chrome for every legal document: a consistent title, a link back to
 * the index, and the entity line every policy has to carry. Individual pages
 * supply only their own prose.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  /** ISO date, e.g. "2026-09-10". Shown and used as the machine-readable value. */
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl px-5 py-16">
      <p className="text-sm">
        <Link
          to="/legal"
          className="text-[var(--color-accent-ink)] hover:underline hover:underline-offset-4"
        >
          ← All legal documents
        </Link>
      </p>
      <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
        {title}
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        Last updated <time dateTime={updated}>{formatDate(updated)}</time>
      </p>
      <div className="prose-legal mt-8 max-w-none">{children}</div>
    </article>
  );
}

/**
 * Shared chrome for a guide: which track it belongs to, a way back to the
 * index, and the date it was last checked against the product.
 *
 * `updated` is the date somebody last read the code this page describes, not
 * the date the file changed. A guide that describes a feature the product
 * does not have is the same defect as a UI note that does, and it reaches
 * more people.
 */
export function DocPage({
  guide,
  updated,
  children,
}: {
  guide: { label: string; track: string };
  /** ISO date, e.g. "2026-09-16". */
  updated: string;
  children: React.ReactNode;
}) {
  const track = DOC_TRACKS.find((candidate) => candidate.id === guide.track);
  return (
    <article className="mx-auto max-w-3xl px-5 py-16">
      <p className="text-sm">
        <Link
          to="/docs"
          className="text-[var(--color-accent-ink)] hover:underline hover:underline-offset-4"
        >
          ← All guides
        </Link>
      </p>
      {track ? (
        <p className="mt-4 font-mono text-sm font-medium tracking-wide text-[var(--color-accent-ink)] uppercase">
          {track.label}
        </p>
      ) : null}
      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
        {guide.label}
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        Checked against the product on{' '}
        <time dateTime={updated}>{formatDate(updated)}</time>
      </p>
      <div className="prose-legal mt-8 max-w-none">{children}</div>
    </article>
  );
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
