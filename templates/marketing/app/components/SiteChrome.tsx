import { NavLink } from 'react-router';
import { ROUTES, SITE } from '../site';

/**
 * The skip link is the first thing in the tab order on every page. Without it
 * a keyboard user walks the whole navigation again on each page they visit.
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
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <NavLink to="/" className="text-lg font-semibold tracking-tight">
            {SITE.name}
          </NavLink>
          <nav aria-label="Main">
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {ROUTES.map((route) => (
                <li key={route.path}>
                  {/* NavLink sets aria-current="page" itself, so the
                      current page is announced as well as coloured. */}
                  <NavLink
                    to={route.path}
                    end={route.path === '/'}
                    className={({ isActive }) =>
                      isActive
                        ? 'font-semibold text-[var(--color-accent)] underline underline-offset-4'
                        : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:underline hover:underline-offset-4'
                    }
                  >
                    {route.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-black/10 dark:border-white/10">
      <div className="mx-auto max-w-5xl px-5 py-8 text-sm text-[var(--color-ink-muted)]">
        <p>
          © {new Date().getFullYear()} {SITE.name}. {SITE.tagline}
        </p>
        <p className="mt-2">
          This is a demonstration site. The company, its products and every
          figure on these pages are invented.
        </p>
      </div>
    </footer>
  );
}

export function Page({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children?: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-5xl px-5 py-12">
      <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        {title}
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-[var(--color-ink-muted)] text-pretty">
        {lead}
      </p>
      {children}
    </article>
  );
}

export function Section({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <h2 className="text-2xl font-semibold tracking-tight">{heading}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
