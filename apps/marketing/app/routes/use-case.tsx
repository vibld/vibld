import { Link, data, useLocation } from 'react-router';

import type { Route } from './+types/use-case';
import { PageHead } from '../components/SiteChrome';
import { SiteMiniature } from '../components/SiteMiniature';
import { DEMO_SITES } from '../demo-sites';
import { examples } from '../examples';
import { specLook } from '../looks';
import { SITE, metaFor } from '../site';
import { USE_CASES, useCaseFor } from '../use-cases';

/** The slug is the last segment: routes.ts declares one path per use case. */
function slugOf(pathname: string): string {
  return pathname.replace(/\/+$/, '').split('/').pop() ?? '';
}

export function meta({ location }: Route.MetaArgs) {
  return metaFor(`/use-cases/${slugOf(location.pathname)}`);
}

/**
 * One kind of project: what to ask for, what comes back, what to know first,
 * and the real examples of it on /examples, quoted from the catalogue as it
 * records them rather than described.
 */
export default function UseCase() {
  const useCase = useCaseFor(slugOf(useLocation().pathname));
  if (!useCase) throw data('Not found', { status: 404 });
  const site = DEMO_SITES[useCase.demo];
  const real = examples().filter((example) =>
    useCase.examples.includes(example.slug),
  );
  const others = USE_CASES.filter((other) => other.slug !== useCase.slug);

  return (
    <>
      <PageHead eyebrow="Use case" title={useCase.title} lead={useCase.lead} />
      <section
        className="lb-section lb-section--tight"
        aria-label={useCase.label}
      >
        <div className="lb-wrap lb-uc">
          <div className="lb-uc__main">
            <h2>What you might ask for</h2>
            <ul className="lb-asks">
              {useCase.asks.map((ask) => (
                <li key={ask}>
                  <q>{ask}</q>
                </li>
              ))}
            </ul>

            <h2>What vibld produces</h2>
            <ul className="lb-ticks">
              {useCase.produces.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>

            <h2>Worth knowing first</h2>
            <ul className="lb-ticks lb-ticks--note">
              {useCase.limits.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>

            <p className="lb-uc__next">
              Then the same flow as everything else: a staged checkpoint to
              read, a private preview, and export, a pull request or a publish
              when you are ready.{' '}
              <Link className="lb-link" to="/how-it-works">
                How it works
              </Link>
            </p>
          </div>

          <aside className="lb-uc__side" aria-labelledby="drawing-title">
            <h2 id="drawing-title" className="lb-uc__side-h">
              An illustration
            </h2>
            <div className={`lb-uc__frame lb-tint--${useCase.tint}`}>
              <SiteMiniature site={site} look={specLook(site.id)} />
            </div>
            <p className="lb-note">
              {site.text.brand} is invented, and drawn in this page rather than
              generated. The{' '}
              <Link className="lb-link" to="/">
                home page
              </Link>{' '}
              shows the demonstration building it.
            </p>
          </aside>
        </div>
      </section>

      <section className="lb-section" aria-labelledby="real-title">
        <div className="lb-wrap">
          <h2 className="lb-h2" id="real-title">
            {real.length === 1 ? 'A real one' : 'Real ones'}
          </h2>
          <p className="lb-lede">
            Built by vibld from the prompt shown, with no hand edits. Each has a
            live copy and its source on the examples page.
          </p>
          <ul className="lb-real">
            {real.map((example) => (
              <li key={example.slug} className="lb-card">
                <h3>{example.title}</h3>
                <p className="lb-real__meta">
                  {example.kind === 'app' ? 'App' : 'Site'}, built by{' '}
                  {example.modelLabel}
                </p>
                <blockquote>
                  <p>{example.prompt}</p>
                </blockquote>
                {example.notes.map((note) => (
                  <p key={note} className="lb-card__limit">
                    <span>Note:</span> {note}
                  </p>
                ))}
                <p>
                  <Link
                    className="lb-link"
                    to={`/examples#example-${example.slug}`}
                  >
                    See it on the examples page
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lb-section" aria-labelledby="more-title">
        <div className="lb-wrap">
          <h2 className="lb-h2" id="more-title">
            Other kinds of project
          </h2>
          <ul className="lb-chiplinks">
            {others.map((other) => (
              <li key={other.slug}>
                <Link to={`/use-cases/${other.slug}`}>{other.label}</Link>
              </li>
            ))}
          </ul>
          <p className="lb-after__cta">
            <Link className="button" to="/#waitlist">
              Join the waitlist
            </Link>
            <a className="lb-link" href={SITE.appUrl}>
              Sign in
            </a>
          </p>
        </div>
      </section>
    </>
  );
}
