import { useState } from 'react';
import { Link, data, useLoaderData } from 'react-router';

import type { Route } from './+types/template';
import { PageHead } from '../components/SiteChrome';
import { SITE, metaFor } from '../site';
import { USE_CASES } from '../use-cases';

/**
 * The id is the last segment: routes.ts declares one path per design. The
 * loader is also asked for `/templates/<id>.data`, React Router's data
 * request, whose suffix is not part of the id.
 */
function idOf(pathname: string): string {
  return (
    pathname
      .replace(/\/+$/, '')
      .replace(/\.data$/, '')
      .split('/')
      .pop() ?? ''
  );
}

export function meta({ location }: Route.MetaArgs) {
  return metaFor(`/templates/${idOf(location.pathname)}`);
}

/** One design, read at build time so the catalog stays out of the bundle. */
export async function loader({ request }: Route.LoaderArgs) {
  const { findDesignTemplate, DESIGN_BASELINE } =
    await import('@vibld/ai/design-templates');
  const { contrastRatio } = await import('@vibld/ai/contrast');
  const template = findDesignTemplate(idOf(new URL(request.url).pathname));
  if (!template) throw data('Not found', { status: 404 });
  return {
    template,
    baseline: DESIGN_BASELINE,
    // Measured here, with vibld's own contrast code, rather than trusted.
    pairs: template.style.contrastChecks
      .filter(
        (c) =>
          c.fg &&
          c.bg &&
          c.target &&
          !c.exempt &&
          !/exempt/i.test(c.use) &&
          /^#[0-9a-f]{6}$/i.test(c.fg) &&
          /^#[0-9a-f]{6}$/i.test(c.bg),
      )
      .map((c) => ({
        use: c.use,
        fg: c.fg!,
        bg: c.bg!,
        target: c.target!,
        ratio: contrastRatio(c.fg!, c.bg!) ?? 0,
      })),
  };
}

const TOKEN_LABELS: [string, string][] = [
  ['background', 'foreground'],
  ['card', 'cardForeground'],
  ['muted', 'mutedForeground'],
  ['primary', 'onPrimary'],
  ['secondary', 'onSecondary'],
  ['accent', 'onAccent'],
  ['destructive', 'onDestructive'],
];

/**
 * One design from the template catalog: everything the catalog records
 * about it, its palette as vibld's tokens, and its build prompt in full,
 * with the baseline every prompt assumes.
 */
export default function Template() {
  const { template: t, baseline, pairs } = useLoaderData<typeof loader>();
  const useCase = USE_CASES.find((u) => u.slug === t.useCase);
  const colors = t.style.tokens.colors as Record<string, string>;
  const derived = new Set<string>(t.style.derived);
  const brief = `${baseline.trim()}\n\n## ${t.name}\n\n${t.buildPrompt.trim()}\n`;

  return (
    <>
      <PageHead eyebrow="Template" title={t.name} lead={t.purpose}>
        <p className="lb-tpl-facts">
          {t.summary} · {t.kind === 'app' ? 'App' : 'Website'} ·{' '}
          {useCase ? (
            <Link to={`/templates#${useCase.slug}`}>{useCase.label}</Link>
          ) : null}{' '}
          · {t.complexity}
        </p>
      </PageHead>

      <section className="lb-section lb-section--tight" aria-label="The design">
        <div className="lb-wrap lb-tpl-detail">
          {t.mergedInto ? (
            <p className="lb-note">
              vibld has built this product: see{' '}
              <Link to={`/examples#example-${t.mergedInto.slug}`}>
                its example
              </Link>
              , generated from one sentence. {t.mergedInto.reason}
            </p>
          ) : null}

          <h2>Who it is for</h2>
          <ul className="lb-ticks">
            {t.audience.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <h2>Layout</h2>
          <ol className="lb-tpl-list">
            {t.layout.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>

          <h2>Palette</h2>
          <p>{t.style.mood}</p>
          <ul className="lb-tpl-palette" aria-label={`${t.name} palette`}>
            {t.style.palette.map((swatch) => (
              <li key={`${swatch.role}-${swatch.hex}`}>
                <span
                  className="lb-tpl-palette__chip"
                  style={{ background: swatch.hex }}
                  aria-hidden="true"
                />
                <span>{swatch.role}</span>
                <code>{swatch.hex}</code>
              </li>
            ))}
          </ul>

          <h3>Every checked pair, measured again</h3>
          <div className="lb-tpl-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">Sample</th>
                  <th scope="col">Where</th>
                  <th scope="col">Ratio</th>
                  <th scope="col">Needs</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((pair) => (
                  <tr key={`${pair.use}-${pair.fg}-${pair.bg}`}>
                    <td>
                      {pair.target >= 4.5 ? (
                        <span
                          className="lb-tpl-pair"
                          style={{ background: pair.bg, color: pair.fg }}
                        >
                          Aa
                        </span>
                      ) : (
                        // A 3:1 pair is a line, a ring or a mark, never text,
                        // so it is drawn as one: this page puts no text in a
                        // pair that was not checked as text.
                        <span
                          className="lb-tpl-pair lb-tpl-pair--mark"
                          style={{ background: pair.bg }}
                          aria-hidden="true"
                        >
                          <i style={{ background: pair.fg }} />
                        </span>
                      )}
                    </td>
                    <td>{pair.use}</td>
                    <td>{pair.ratio.toFixed(2)}:1</td>
                    <td>{pair.target}:1</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>As vibld’s tokens</h3>
          <p>
            The palette on the fifteen colour tokens vibld styles a project
            with, each text colour on the fill it is read on.
            {derived.size > 0
              ? ' Marked tokens are solved from the palette, because no swatch held that role at 4.5:1.'
              : ''}
          </p>
          <ul className="lb-swatches lb-tpl-tokens">
            {TOKEN_LABELS.map(([fill, ink]) => (
              <li
                key={fill}
                style={{ background: colors[fill], color: colors[ink] }}
              >
                {fill}
                {derived.has(fill) || derived.has(ink) ? ' *' : ''}
              </li>
            ))}
          </ul>

          <h2>Type</h2>
          <dl className="lb-tpl-type">
            <dt>Display</dt>
            <dd>
              {t.style.typography.display}
              <FontNote font={t.style.fonts.display} />
            </dd>
            <dt>Body</dt>
            <dd>
              {t.style.typography.body}
              <FontNote font={t.style.fonts.body} />
            </dd>
          </dl>
          {t.style.typography.notes ? <p>{t.style.typography.notes}</p> : null}

          <h2>Spacing and imagery</h2>
          <p>{t.style.spacing}</p>
          <p>{t.style.imagery}</p>

          <h2>Components</h2>
          <ul className="lb-ticks">
            {t.components.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <h2>Interactions</h2>
          <ul className="lb-ticks">
            {t.interactions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <h2>Data</h2>
          <ul className="lb-tpl-list">
            {t.dataModel.map((line) => (
              <li key={line}>
                <code>{line}</code>
              </li>
            ))}
          </ul>

          <h2 id="build-prompt">Build prompt</h2>
          <p>
            The baseline every prompt in the catalog assumes, then this design’s
            own ten sections, from goal to guardrails.
          </p>
          <CopyButton text={brief} />
          <details className="lb-tpl-baseline">
            <summary>The baseline</summary>
            <pre>{baseline.trim()}</pre>
          </details>
          <pre className="lb-tpl-prompt">{t.buildPrompt.trim()}</pre>

          <p className="lb-after__cta">
            <a className="button" href={SITE.appUrl}>
              Open the builder
            </a>
            <Link className="lb-link" to="/templates">
              All templates
            </Link>
            <Link className="lb-link" to={`/inspiration#style-${t.id}`}>
              This palette on its own
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}

function FontNote({
  font,
}: {
  font: { family: string; onGoogleFonts: boolean; substitute?: string };
}) {
  if (font.onGoogleFonts) return null;
  return (
    <span className="lb-tpl-fontnote">
      {' '}
      ({font.family === 'system-ui' ? 'the system face' : font.family} is not on
      Google Fonts; a vibld project loads {font.substitute})
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <p>
      <button
        type="button"
        className="button"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        Copy the baseline and build prompt
      </button>{' '}
      <span role="status">{copied ? 'Copied.' : ''}</span>
    </p>
  );
}
