import { Link, useLoaderData } from 'react-router';

import { PageHead } from '../components/SiteChrome';
import { SITE, metaFor } from '../site';

export function meta() {
  return metaFor('/inspiration');
}

/**
 * Every design's palette and type, read at build time: only what the
 * gallery draws reaches the page, never the catalog.
 */
export async function loader() {
  const { DESIGN_TEMPLATES } = await import('@vibld/ai/design-templates');
  return {
    styles: DESIGN_TEMPLATES.map((t) => {
      const c = t.style.tokens.colors;
      return {
        id: t.id,
        name: t.name,
        mood: t.style.mood.split('.')[0]!,
        background: c.background,
        foreground: c.foreground,
        primary: c.primary,
        onPrimary: c.onPrimary,
        palette: t.style.palette
          .filter((s) => /^#[0-9a-f]{6}$/i.test(s.hex))
          .map((s) => ({ role: s.role, hex: s.hex })),
        display: t.style.fonts.display.asWritten,
        body: t.style.fonts.body.asWritten,
        headingFont: t.style.tokens.typography.headingFont,
        bodyFont: t.style.tokens.typography.bodyFont,
      };
    }),
  };
}

/**
 * The inspiration gallery (docs/decisions.md, D83): each design's palette
 * and type pairing on their own, as a style to borrow. The sample on each is
 * the design's own ink on its own page and its own label on its own fill,
 * pairs the catalog checked and packages/ai/test/design-templates.test.ts
 * measures again.
 */
export default function Inspiration() {
  const { styles } = useLoaderData<typeof loader>();
  return (
    <>
      <PageHead
        eyebrow="Inspiration"
        title="Palettes and type to borrow"
        lead={`${styles.length} palettes and type pairings from the template catalog. Every text pair in them passes WCAG AA; the sample on each card is drawn only in the palette's own pairs.`}
      >
        <p className="lb-tpl-facts">
          <Link to="/templates">The designs they come from</Link> ·{' '}
          <Link to="/styles">The directions vibld builds in</Link>
        </p>
      </PageHead>
      <section className="lb-section lb-section--tight" aria-label="Styles">
        <div className="lb-wrap">
          <ul className="lb-gallery">
            {styles.map((style) => (
              <li
                key={style.id}
                className="lb-gallery__item"
                id={`style-${style.id}`}
              >
                <div
                  className="lb-gallery__sample"
                  style={{
                    background: style.background,
                    color: style.foreground,
                  }}
                >
                  <span className="lb-gallery__aa" aria-hidden="true">
                    Aa
                  </span>
                  <span
                    className="lb-gallery__button"
                    aria-hidden="true"
                    style={{
                      background: style.primary,
                      color: style.onPrimary,
                    }}
                  >
                    Button
                  </span>
                </div>
                <ul
                  className="lb-gallery__palette"
                  aria-label={`${style.name} palette`}
                >
                  {style.palette.map((swatch) => (
                    <li
                      key={`${swatch.role}-${swatch.hex}`}
                      style={{ background: swatch.hex }}
                      title={`${swatch.role} ${swatch.hex}`}
                    >
                      <span className="visually-hidden">
                        {swatch.role} {swatch.hex}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="lb-gallery__meta">
                  <h2>
                    <Link to={`/templates/${style.id}`}>{style.name}</Link>
                  </h2>
                  <p>{style.mood}</p>
                  <p className="lb-tpl__facts">
                    {style.display.split(',')[0]} / {style.body.split(',')[0]}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p className="lb-note">
            Samples use this site’s own fonts, not each style’s, which a vibld
            project loads from Google Fonts (naming a close substitute where a
            design’s face is not served there).
          </p>
          <p className="lb-after__cta">
            <a className="button" href={SITE.appUrl}>
              Open the builder
            </a>
          </p>
        </div>
      </section>
    </>
  );
}
