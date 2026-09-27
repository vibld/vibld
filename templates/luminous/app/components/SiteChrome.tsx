import { useEffect, useRef } from 'react';
import { Link, NavLink, useLocation } from 'react-router';

import { ROUTES, SITE } from '../site';
import { Icon, Waves } from './Icon';

/** Every page except home, which the logo already links to. */
const NAV = ROUTES.filter((route) => route.path !== '/');

/**
 * The skip link is the first thing in the tab order on every page. Without it
 * a keyboard user walks the whole navigation again on each page they visit.
 *
 * On small screens the links sit in a <details> disclosure, which opens and
 * closes with no script at all. The only thing JavaScript adds is closing it
 * after a navigation, because a client-side route change does not reload the
 * page and would otherwise leave the menu hanging open over the new one.
 */
export function SiteHeader() {
  const menu = useRef<HTMLDetailsElement>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);

  return (
    <>
      <a href="#main" className="skip">
        Skip to main content
      </a>
      <header className="nav">
        <div className="wrap">
          <nav className="nav-bar" aria-label="Main">
            <NavLink to="/" className="logo" end>
              <span className="logo-mark" aria-hidden="true" />
              {SITE.name}
            </NavLink>
            <ul className="nav-links">
              {NAV.map((route) => (
                <li key={route.path}>
                  {/* NavLink sets aria-current="page" itself, so the
                      current page is announced as well as shown. */}
                  <NavLink to={route.path}>{route.label}</NavLink>
                </li>
              ))}
            </ul>
            <div className="nav-end">
              <Link to="/contact" className="btn btn-primary nav-cta">
                Get a demo
              </Link>
              <details className="menu" ref={menu}>
                <summary aria-label="Menu">
                  <Icon name="menu" />
                </summary>
                <ul className="menu-list">
                  {ROUTES.map((route) => (
                    <li key={route.path}>
                      <NavLink to={route.path} end={route.path === '/'}>
                        {route.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          </nav>
        </div>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="wrap">
        <div className="foot">
          <div>
            <Link to="/" className="logo">
              <span className="logo-mark" aria-hidden="true" />
              {SITE.name}
            </Link>
            <p className="foot-tag">{SITE.tagline}</p>
            <p className="mt-2.5 max-w-[26em]">
              Customer feedback from every channel, in one inbox, grouped into
              themes your team can act on.
            </p>
          </div>
          <div>
            <h2>Pages</h2>
            <ul>
              {ROUTES.map((route) => (
                <li key={route.path}>
                  <Link to={route.path}>{route.label}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2>About this site</h2>
            <p>
              A demonstration. Emberline, its plans, its prices and the sample
              messages on these pages are invented.
            </p>
          </div>
        </div>
        <div className="foot-bottom">
          <span>
            © {new Date().getFullYear()} {SITE.name}
          </span>
          <span>No customer logos, reviews or usage figures appear here.</span>
        </div>
      </div>
    </footer>
  );
}

/**
 * The head of every page other than home: the same light as the home hero,
 * drawn as a static gradient, with the page's one h1.
 */
export function PageHead({
  kicker,
  title,
  emphasis,
  lead,
  children,
}: {
  kicker: string;
  title: string;
  /** Set in the serif italic after the title, the way the home hero is. */
  emphasis?: string;
  lead: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="page-head" aria-labelledby="page-title">
      <Waves />
      <div className="wrap">
        <p className="kicker warm">{kicker}</p>
        <h1 id="page-title">
          {title}
          {emphasis ? (
            <>
              {' '}
              <em className="display-em">{emphasis}</em>
            </>
          ) : null}
        </h1>
        <p className="lead">{lead}</p>
        {children}
      </div>
    </section>
  );
}

export function SectionHead({
  id,
  kicker,
  warm,
  title,
  emphasis,
  lead,
}: {
  id: string;
  kicker: string;
  warm?: boolean;
  title: string;
  emphasis?: string;
  lead?: string;
}) {
  return (
    <div className="sec-head">
      <p className={warm ? 'kicker warm' : 'kicker'}>{kicker}</p>
      <h2 id={id}>
        {title}
        {emphasis ? (
          <>
            {' '}
            <em className="display-em">{emphasis}</em>
          </>
        ) : null}
      </h2>
      {lead ? <p className="sec-lead">{lead}</p> : null}
    </div>
  );
}

/** The warm card that closes the home and pricing pages. */
export function Closing() {
  return (
    <section className="closing" aria-labelledby="close-title">
      <div className="wrap">
        <div className="close-card">
          <Waves />
          <h2 id="close-title">
            Hear everyone. <em className="display-em">Build what matters.</em>
          </h2>
          <p>
            Bring a week of your own feedback to a walkthrough and see which
            themes it forms, before you connect anything.
          </p>
          <div className="cta-row">
            <Link to="/contact" className="btn btn-primary">
              Get a demo
            </Link>
            <Link to="/pricing" className="btn btn-ghost">
              See pricing
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
