import { catalogue, withPalettes } from '../catalogue';
import { Page } from '../components/SiteChrome';
import { SITE, metaFor } from '../site';

export function meta() {
  return metaFor('/styles');
}

/**
 * The catalogue of visual directions (#186).
 *
 * Read from the builder's own preset list, so this page cannot drift from
 * what the product will actually do. See `app/catalogue.ts`.
 *
 * Every swatch shows a preset's own fill with the ink that preset names for
 * it -- pairs `packages/ai` verifies at 4.5:1. This site's ink never
 * touches somebody else's fill, which would inherit no proof at all.
 */
export default function Styles() {
  const entries = catalogue();
  const coloured = withPalettes(entries);

  return (
    <Page
      eyebrow="Styles"
      title="Directions vibld builds in"
      lead="Ask for one by name, or ask for three sketches and pick. Every direction here is one the builder actually knows; this page is generated from the same list it reads."
    >
      <div className="mt-12">
        <p className="max-w-2xl text-[var(--color-ink-muted)] text-pretty">
          {coloured.length} of these carry a full colour system, shown below in
          their own palettes. The rest are surface treatments -- how a page
          feels rather than what colour it is -- so they wear whatever palette
          the project needs, and inventing one for them here would show you a
          choice the builder does not make.
        </p>

        <ul className="mt-10 grid gap-6 sm:grid-cols-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="rounded-lg border border-black/10 p-5 dark:border-white/10"
            >
              <h2 className="font-display text-lg font-bold tracking-tight">
                {entry.name}
              </h2>
              <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                {entry.description}
              </p>

              {entry.pairs ? (
                <ul
                  className="mt-4 grid grid-cols-4 gap-2"
                  aria-label="Palette"
                >
                  {entry.pairs.map((pair) => (
                    <li
                      key={pair.label}
                      className="rounded px-2 py-3 text-center text-xs"
                      // The preset's own pair, never this site's ink on it.
                      style={{ background: pair.fill, color: pair.ink }}
                    >
                      {pair.label}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-xs text-[var(--color-ink-muted)]">
                  Any palette. This one is a treatment, not a colour scheme.
                </p>
              )}
            </li>
          ))}
        </ul>

        <p className="mt-12 text-[var(--color-ink-muted)]">
          <a
            className="font-medium text-[var(--color-accent-ink)] underline underline-offset-4"
            href={SITE.appUrl}
          >
            Open the builder
          </a>{' '}
          and ask for one of these, or ask for three sketches first and choose
          between them.
        </p>
      </div>
    </Page>
  );
}
