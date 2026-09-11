import { Link } from 'react-router';
import { LEGAL_DOCS, SITE } from '../site';

/**
 * The skip link is the first thing in the tab order on every page. Without it
 * a keyboard user walks the whole header again on each page they visit.
 */
export function SiteHeader() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-md focus:bg-[var(--color-accent)] focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to main content
      </a>
      <header className="border-b border-black/10 dark:border-white/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
          <Link to="/" className="flex items-center gap-2.5">
            <svg
              width="24"
              height="24"
              viewBox="0 0 32 32"
              fill="none"
              aria-hidden="true"
            >
              <rect width="32" height="32" rx="7" fill="oklch(0.19 0.02 40)" />
              <path
                d="M8 10l8 12 8-12"
                stroke="oklch(0.68 0.19 45)"
                strokeWidth="3.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-lg font-semibold tracking-tight">vibld</span>
          </Link>
          <span className="hidden text-sm text-[var(--color-ink-muted)] sm:inline">
            {SITE.tagline}
          </span>
        </div>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-black/10 dark:border-white/10">
      <div className="mx-auto max-w-5xl px-5 py-10 text-sm text-[var(--color-ink-muted)]">
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

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
