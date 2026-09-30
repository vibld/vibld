import { Link, useLoaderData } from 'react-router';
import type { ComponentType } from 'react';

import { catalogue, withPalettes } from '../catalogue';
import type { CatalogueEntry } from '../catalogue';
import { AuroraMesh } from '../components/backdrop/aurora-mesh';
import { FlowLines } from '../components/backdrop/flow-lines';
import { GrainBlobs } from '../components/backdrop/grain-blobs';
import { ParticleField } from '../components/backdrop/particle-field';
import { PageHead } from '../components/SiteChrome';
import { SiteMiniature } from '../components/SiteMiniature';
import { DEMO_SITES, DEMO_SITE_IDS } from '../demo-sites';
import { lookById } from '../looks';
import { PRESET_MOODS, STYLE_MOODS } from '@vibld/ai/style-presets';
import type { StylePresetId } from '@vibld/ai/style-presets';
import { SITE, metaFor } from '../site';
import { approxCount } from '../counts';

export function meta() {
  return metaFor('/styles');
}

/**
 * What each moving background is and what asks for it, from the recipes the
 * builder reads (packages/ai/src/backdrops.ts). Read in the loader, so the
 * recipes' source strings stay out of this page's bundle: the page runs the
 * components generated from them instead (scripts/backdrops.ts).
 */
export async function loader() {
  const { BACKDROPS } = await import('@vibld/ai/backdrops');
  return {
    backdrops: BACKDROPS.map((recipe) => ({
      id: recipe.id,
      component: recipe.component,
      looks: recipe.looks,
      triggers: recipe.triggers.slice(0, 4),
    })),
  };
}

/** The components /styles runs, by the name each recipe exports. */
const BACKDROP_COMPONENTS: Record<
  string,
  ComponentType<{ colors?: readonly string[] }>
> = { AuroraMesh, ParticleField, GrainBlobs, FlowLines };

/**
 * One demonstration palette apiece: this page's choice, for the drawing. In
 * a project a background takes the project's own colour tokens.
 */
const BACKDROP_COLORS: Record<string, readonly string[]> = {
  AuroraMesh: ['#0b1026', '#ff4a1c', '#7c5cff', '#16c2d5'],
  ParticleField: ['#ffb199', '#ff4a1c'],
  GrainBlobs: ['#ff7a59', '#f9c74f', '#8e7dff'],
  FlowLines: ['#5eead4', '#38bdf8', '#eeeee9'],
};

/** The ground under each one, which the components draw over. */
const BACKDROP_GROUND: Record<string, string> = {
  AuroraMesh: '#0b1026',
  ParticleField: '#0e0f11',
  GrainBlobs: '#1a1030',
  FlowLines: '#07131a',
};

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
  const { backdrops } = useLoaderData<typeof loader>();

  return (
    <>
      <PageHead
        eyebrow="Styles"
        title="Directions vibld builds in"
        lead="Ask for one by name, or ask for three sketches and pick. Every direction here is one the builder actually knows; this page is generated from the same list it reads."
      />
      <section className="lb-section lb-section--tight" aria-label="Moods">
        <div className="lb-wrap">
          <p className="lb-lede">
            Each style carries one to three moods:{' '}
            {STYLE_MOODS.map((mood) => mood.name.toLowerCase()).join(', ')}. In
            the builder’s style picker a mood narrows the list, and the styles
            whose moods your request names are listed as “Suggested for your
            request”. A suggestion is only a mark: nothing is picked for you.
          </p>
        </div>
      </section>
      <section
        className="lb-section lb-section--tight"
        aria-labelledby="backdrops-title"
        id="backgrounds"
      >
        <div className="lb-wrap">
          <h2 className="lb-h2" id="backdrops-title">
            {approxCount(backdrops.length)} moving backgrounds
          </h2>
          <p className="lb-lede">
            A moving background is asked for in words rather than picked: say
            “animated background”, or name one, and the build can use one of
            these four. Each runs here from the same file a build writes into a
            project. In a project it takes the project’s own colours; the ones
            here are ours, for the drawing. They pause off screen and hold still
            if you have asked your system for less motion.
          </p>
          <ul className="lb-backdrops">
            {backdrops.map((backdrop) => {
              const Backdrop = BACKDROP_COMPONENTS[backdrop.component];
              return (
                <li key={backdrop.id} id={`backdrop-${backdrop.id}`}>
                  <div
                    className="lb-backdrop__stage"
                    style={{ background: BACKDROP_GROUND[backdrop.component] }}
                  >
                    {Backdrop ? (
                      <Backdrop colors={BACKDROP_COLORS[backdrop.component]} />
                    ) : null}
                  </div>
                  <h3>
                    <code>{`<${backdrop.component} />`}</code>
                  </h3>
                  <p>{backdrop.looks}</p>
                  <p className="lb-style__demo">
                    Asked for with: {backdrop.triggers.join(', ')}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
      <section
        className="lb-section lb-section--tight"
        aria-labelledby="treatments-title"
      >
        <div className="lb-wrap">
          <h2 className="lb-h2" id="treatments-title">
            {approxCount(treatments.length)} surface treatments
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
            {approxCount(coloured.length)} with a colour system of their own
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
            <a className="lb-link" href={SITE.signUpUrl}>
              Sign up
            </a>
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
              <p className="lb-style__demo">
                Moods:{' '}
                {PRESET_MOODS[entry.id as StylePresetId]
                  .map(
                    (id) =>
                      STYLE_MOODS.find((mood) => mood.id === id)?.name ?? id,
                  )
                  .join(', ')}
              </p>
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
