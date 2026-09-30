import { useRef } from 'react';
import { Link, useLocation } from 'react-router';
import { CONSENT_OPEN_EVENT } from '../consent.ts';
import { Lockup } from './Mark.tsx';
import { DOC_TRACKS, LEGAL_DOCS, PRODUCT_PAGES, SITE } from '../site';

/** The pages the header lists at full width. The menu lists them all. */
const HEADER_PAGES = PRODUCT_PAGES.filter((page) => page.path !== '/use-cases');

/**
 * The skip link is the first thing in the tab order on every page. Without it
 * a keyboard user walks the whole header again on each page they visit.
 */
export function SiteHeader() {
  const menu = useRef<HTMLDetailsElement | null>(null);
  const { pathname } = useLocation();
  const closeMenu = () => {
    if (menu.current) menu.current.open = false;
  };

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-md focus:bg-[var(--color-accent)] focus:px-4 focus:py-2 focus:text-[var(--color-on-accent)]"
      >
        Skip to main content
      </a>
      {/*
        A floating pill over a blurred wash of the paper, from the Live Build
        design: the way in stays in reach on a page that is long.
      */}
      <header className="lb-nav">
        <div className="lb-nav__in">
          <Link to="/" className="lb-nav__brand">
            <Lockup />
          </Link>
          {/*
            The product pages, at a width that has room for them. /styles is
            among them on purpose: it was prerendered and in the sitemap but
            linked only from behind the sign-in it exists to precede, so a
            crawler could find it and a visitor could not.
          */}
          <nav aria-label="Main" className="lb-nav__main">
            <ul>
              {HEADER_PAGES.map((page) => (
                <li key={page.path}>
                  <Link
                    to={page.path}
                    aria-current={pathname === page.path ? 'page' : undefined}
                  >
                    {page.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  to="/docs"
                  aria-current={pathname === '/docs' ? 'page' : undefined}
                >
                  Docs
                </Link>
              </li>
            </ul>
          </nav>
          <div className="lb-nav__end">
            {/*
              A plain anchor: app.vibld.com is a different Worker on a
              different host, so routing to it client-side would 404 in the
              router before the browser ever left this origin.
            */}
            <a href={SITE.appUrl} className="lb-nav__signin">
              Sign in
            </a>
            {/*
              The open beta's way in (2026-09-27). It used to be "Join the
              waitlist", a link to the form on the home page; anybody can
              sign up now, so it goes straight to the builder's sign-up form.
              A plain anchor for the same reason as the one above.
            */}
            <a href={SITE.signUpUrl} className="button button--small">
              <span className="lb-nav__cta-long">Sign up for the beta</span>
              <span className="lb-nav__cta-short" aria-hidden="true">
                Sign up
              </span>
            </a>
            {/*
              A disclosure rather than a scripted drawer, so the menu opens
              before hydration and without JavaScript at all.
            */}
            <details className="lb-menu" ref={menu}>
              <summary>Menu</summary>
              <nav aria-label="Menu">
                <ul>
                  {PRODUCT_PAGES.map((page) => (
                    <li key={page.path}>
                      <Link to={page.path} onClick={closeMenu}>
                        {page.label}
                      </Link>
                    </li>
                  ))}
                  <li>
                    <Link to="/docs" onClick={closeMenu}>
                      Docs
                    </Link>
                  </li>
                  <li>
                    <a href={SITE.appUrl}>Sign in</a>
                  </li>
                  <li>
                    <a href={SITE.signUpUrl}>Sign up</a>
                  </li>
                </ul>
              </nav>
            </details>
          </div>
        </div>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="lb-foot">
      <div className="lb-wrap">
        <div className="lb-foot__grid">
          <div className="lb-foot__brand">
            <Link to="/" className="lb-nav__brand">
              <Lockup />
            </Link>
            <p>
              {SITE.tagline} A conversation in, a folder of files out. The core
              is open source under Apache-2.0.
            </p>
            <p>
              <a href={SITE.repoUrl}>The source on GitHub</a>
            </p>
            <p>
              Built by{' '}
              <a href={SITE.founder.url} rel="author">
                {SITE.founder.name}
              </a>
            </p>
          </div>
          <nav aria-label="Product">
            <h2>Product</h2>
            <ul>
              {PRODUCT_PAGES.map((page) => (
                <li key={page.path}>
                  <Link to={page.path}>{page.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
          {/*
            The two tracks and the guides a visitor asks about before signing
            up, not all nine. The index is the navigation; a footer that lists
            every page is a second, worse copy of it.
          */}
          <nav aria-label="Guides">
            <h2>Docs</h2>
            <ul>
              {DOC_TRACKS.map((track) => (
                <li key={track.id}>
                  <Link to={`/docs#${track.id}`}>{track.label}</Link>
                </li>
              ))}
              <li>
                <Link to="/docs/credits-and-plans">Credits and plans</Link>
              </li>
              <li>
                <Link to="/docs/taking-your-code">
                  Taking your code with you
                </Link>
              </li>
              <li>
                <a href={SITE.appUrl}>Sign in</a>
              </li>
            </ul>
          </nav>
          <nav aria-label="Legal">
            <h2>Legal</h2>
            <ul>
              {LEGAL_DOCS.map((doc) => (
                <li key={doc.slug}>
                  <Link to={`/legal/${doc.slug}`}>{doc.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="lb-foot__base">
          <p>
            © {new Date().getFullYear()} {SITE.legalEntity}.{' '}
            {SITE.mailingAddress}.
          </p>
          <p>
            <a href={`mailto:${SITE.emails.support}`}>{SITE.emails.support}</a>
          </p>
          <p>
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))
              }
            >
              Cookie preferences
            </button>
          </p>
        </div>
      </div>
    </footer>
  );
}

/** The heading block every product page opens with. */
export function PageHead({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="lb-pagehead">
      <div className="lb-wrap">
        {eyebrow ? <p className="lb-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {lead ? <p className="lb-lede">{lead}</p> : null}
        {children}
      </div>
    </header>
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
  lead?: string;
  children?: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-6xl px-5 py-16">
      {eyebrow ? <p className="lb-eyebrow">{eyebrow}</p> : null}
      <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-balance sm:text-5xl">
        {title}
      </h1>
      {lead ? (
        <p className="mt-4 max-w-2xl text-lg text-[var(--color-ink-muted)] text-pretty">
          {lead}
        </p>
      ) : null}
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
  /**
   * `SITE.legalEffectiveDate`, which every legal page passes: an ISO date,
   * e.g. "2026-09-10", shown and used as the machine-readable value. Anything
   * that is not an ISO date (the launch-day placeholder it holds until the
   * launch deploy) is shown as written, with no `<time>` element claiming to
   * be a date.
   */
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
        Last updated{' '}
        {/^\d{4}-\d{2}-\d{2}$/.test(updated) ? (
          <time dateTime={updated}>{formatDate(updated)}</time>
        ) : (
          updated
        )}
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
