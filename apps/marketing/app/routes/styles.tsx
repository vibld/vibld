import { Link } from 'react-router';

import { catalogue, withPalettes } from '../catalogue';
import type { CatalogueEntry } from '../catalogue';
import { PageHead } from '../components/SiteChrome';
import { SiteMiniature } from '../components/SiteMiniature';
import { DEMO_SITES, DEMO_SITE_IDS } from '../demo-sites';
import { lookById } from '../looks';
import type { StylePresetId } from '@vibld/ai/style-presets';
import { SITE, metaFor } from '../site';

export function meta() {
  return metaFor('/styles');
}

/**
 * The catalogue of visual directions (internal issue 186), each one drawn.
 *
 * Read from the builder's own preset list, so this page cannot drift from
 * what the product will actually do. See `app/catalogue.ts`.
 *
 * Every preview is a miniature site in HTML and CSS (components/
 * SiteMiniature.tsx), never an image. A direction with its own palette is
 * drawn only in its own pairs, which `packages/ai` verifies at 4.5:1; this
 * site's ink never touches somebody else's fill. A surface treatment, which
 * has no palette on purpose, is drawn in one neutral demonstration palette
 * (`DEMO_PALETTE` in looks.ts, measured in test/looks.test.ts), and the page
 * says so above the previews and on each one.
 */
export default function Styles() {
  const entries = catalogue();
  const coloured = withPalettes(entries);
  const treatments = entries.filter((entry) => entry.pairs === null);

  return (
    <>
      <PageHead
        eyebrow="Styles"
        title="Directions vibld builds in"
        lead="Ask for one by name, or ask for three sketches and pick. Every direction here is one the builder actually knows; this page is generated from the same list it reads."
      />
      <section
        className="lb-section lb-section--tight"
        aria-labelledby="treatments-title"
      >
        <div className="lb-wrap">
          <h2 className="lb-h2" id="treatments-title">
            {treatments.length} surface treatments
          </h2>
          <p className="lb-lede">
            How a page feels rather than what colour it is: glass, extrusion,
            hard rules, drifting light. They wear whatever palette the project
            needs, so each is drawn here in the same neutral demonstration
            palette. Those colours are ours, for the drawing, and not a choice
            the builder makes.
          </p>
          <StyleGrid entries={treatments} offset={0} />
        </div>
      </section>
      <section className="lb-section" aria-labelledby="palettes-title">
        <div className="lb-wrap">
          <h2 className="lb-h2" id="palettes-title">
            {coloured.length} with a colour system of their own
          </h2>
          <p className="lb-lede">
            These carry real tokens the builder sends with the request: a
            palette, fonts and radii. Each is drawn only in its own colours, and
            every text colour is shown on the fill the preset pairs it with.
          </p>
          <StyleGrid entries={coloured} offset={treatments.length} />
          <p className="lb-note">
            Headings in these drawings use this site’s own fonts and the
            system’s serif, not the fonts each preset names, which the builder
            loads in the project it generates.
          </p>
        </div>
      </section>
      <section className="lb-section" aria-label="Try one">
        <div className="lb-wrap">
          <p className="lb-after__cta">
            <a className="button" href={SITE.appUrl}>
              Open the builder
            </a>
            <Link className="lb-link" to="/#waitlist">
              Join the waitlist
            </Link>
            <Link className="lb-link" to="/examples">
              See real output
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}

function StyleGrid({
  entries,
  offset,
}: {
  entries: CatalogueEntry[];
  offset: number;
}) {
  return (
    <ul className="lb-styles">
      {entries.map((entry, index) => {
        const look = lookById(entry.id as StylePresetId);
        const site =
          DEMO_SITES[DEMO_SITE_IDS[(index + offset) % DEMO_SITE_IDS.length]!];
        return (
          <li key={entry.id} className="lb-style" id={`style-${entry.id}`}>
            <div className="lb-style__frame">
              <SiteMiniature site={site} look={look} />
            </div>
            <div className="lb-style__meta">
              <h3>{entry.name}</h3>
              <p>{entry.description}</p>
              {entry.pairs ? (
                <ul
                  className="lb-swatches"
                  aria-label={`${entry.name} palette`}
                >
                  {entry.pairs.map((pair) => (
                    <li
                      key={pair.label}
                      // The preset's own pair, never this site's ink on it.
                      style={{ background: pair.fill, color: pair.ink }}
                    >
                      {pair.label}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="lb-style__demo">
                  Any palette. Drawn in the demonstration colours.
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
