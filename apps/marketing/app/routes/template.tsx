import { useState } from 'react';
import { Link, data, useLoaderData } from 'react-router';

import type { Route } from './+types/template';
import { PageHead } from '../components/SiteChrome';
import { TemplatePreview } from '../components/TemplatePreview';
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

export function links() {
  return [{ rel: 'stylesheet', href: '/fonts/templates/faces.css' }];
}

/** One design, read at build time so the catalog stays out of the bundle. */
export async function loader({ request }: Route.LoaderArgs) {
  const {
    findDesignTemplate,
    baselineFor,
    designsMergedInto,
    SCREEN_PATTERNS,
  } = await import('@vibld/ai/design-templates');
  const { MAX_COMPOSED_SCREENS } = await import('@vibld/ai/screen-patterns');
  const { contrastRatio } = await import('@vibld/ai/contrast');
  const template = findDesignTemplate(idOf(new URL(request.url).pathname));
  if (!template) throw data('Not found', { status: 404 });
  const { TEMPLATE_FONTS } = await import('../template-fonts.gen');
  const { previewSpec, fontStack } = await import('../template-preview');
  const GENERIC: Record<string, string> = {
    serif: 'Georgia, serif',
    monospace: 'ui-monospace, monospace',
    handwriting: 'cursive',
  };
  const genericOf = (family: string) =>
    GENERIC[TEMPLATE_FONTS[family]?.category ?? ''] ?? 'system-ui, sans-serif';
  return {
    preview: previewSpec(template, genericOf),
    faceCss: Object.fromEntries(
      template.style.typeSet.map((f) => [
        f.family,
        fontStack(f.family, genericOf(f.family)),
      ]),
    ),
    template,
    baseline: baselineFor(template),
    mergedIntoName: template.mergedInto
      ? (findDesignTemplate(template.mergedInto.slug)?.name ?? null)
      : null,
    alternates: designsMergedInto(template.id).map((t) => ({
      id: t.id,
      name: t.name,
      summary: t.summary,
    })),
    // What a reader can add to this design (D110): every screen pattern,
    // by name, and not its text, which the builder fetches itself.
    screens:
      template.format === 'screen'
        ? []
        : SCREEN_PATTERNS.map((screen) => ({
            id: screen.id,
            name: screen.name,
            summary: screen.summary,
            type: screen.category,
          })),
    maxScreens: MAX_COMPOSED_SCREENS,
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
  const {
    template: t,
    baseline,
    pairs,
    preview,
    faceCss,
    mergedIntoName,
    alternates,
    screens,
    maxScreens,
  } = useLoaderData<typeof loader>();
  const [chosen, setChosen] = useState<string[]>([]);
  const isScreen = t.format === 'screen';
  const useCase = USE_CASES.find((u) => u.slug === t.useCase);
  const colors = t.style.tokens.colors as Record<string, string>;
  const derived = new Set<string>(t.style.derived);
  const brief = `${baseline.trim()}\n\n## ${t.name}\n\n${t.buildPrompt.trim()}\n`;
  // "Start from this template" (D106): the builder fills its composer from
  // the fragment, which never reaches a server (apps/web/src/templates).
  // Chosen screens go by id; the builder adds their text (D110).
  const startUrl = `${SITE.appUrl}/#${new URLSearchParams({
    template: t.id,
    brief,
    ...(chosen.length > 0 ? { screens: chosen.join(',') } : {}),
  }).toString()}`;

  return (
    <>
      <PageHead eyebrow="Template" title={t.name} lead={t.purpose}>
        <p className="lb-tpl-facts">
          {t.summary} ·{' '}
          {isScreen
            ? `App screen: ${t.category.replace(/-/g, ' ')}`
            : t.format === 'page'
              ? 'Single page'
              : t.kind === 'app'
                ? 'App'
                : 'Website'}{' '}
          ·{' '}
          {useCase ? (
            <Link to={`/use-cases/${useCase.slug}`}>{useCase.label}</Link>
          ) : null}{' '}
          · {t.complexity}
        </p>
      </PageHead>

      <section className="lb-section lb-section--tight" aria-label="The design">
        <div className="lb-wrap lb-tpl-detail">
          <div className="lb-tpl-hero">
            <TemplatePreview spec={preview} />
          </div>
          <p className="lb-note">
            {isScreen
              ? 'A mock-up of the screen, drawn from its layout, palette and typefaces. A build follows the full prompt below.'
              : 'A mock-up of the homepage, drawn from this design’s layout, palette and typefaces. A build follows the full prompt below.'}
          </p>
          {screens.length > 0 ? (
            <ScreenPicker
              screens={screens}
              chosen={chosen}
              max={maxScreens}
              onChange={setChosen}
            />
          ) : null}
          <p className="lb-after__cta">
            <a className="button" href={startUrl}>
              {isScreen
                ? 'Start from this screen'
                : chosen.length > 0
                  ? `Start from this template with ${chosen.length} ${chosen.length === 1 ? 'screen' : 'screens'}`
                  : 'Start from this template'}
            </a>
            <a className="lb-link" href="#build-prompt">
              Read the build prompt
            </a>
          </p>

          <h2>Typefaces</h2>
          <p>{t.style.typeWhy}</p>
          <ul className="lb-tpl-typeset">
            {t.style.typeSet.map((face) => (
              <li key={`${face.family}-${face.role}`}>
                <span
                  className="lb-tpl-typeset__sample"
                  style={{ fontFamily: faceCss[face.family] }}
                >
                  {face.family}
                </span>
                <span>
                  {face.role === 'display'
                    ? 'Headings'
                    : face.role === 'body'
                      ? 'Body'
                      : face.role === 'mono'
                        ? 'Figures and code'
                        : face.role === 'script'
                          ? 'Handwriting'
                          : face.role === 'ui'
                            ? 'Interface'
                            : 'Accent'}
                  : {face.use}
                </span>
              </li>
            ))}
          </ul>

          {t.mergedInto?.collection === 'examples' ? (
            <p className="lb-note">
              vibld has built this product: see{' '}
              <Link to={`/examples#example-${t.mergedInto.slug}`}>
                its example
              </Link>
              , generated from one sentence. {t.mergedInto.reason}
            </p>
          ) : null}
          {t.mergedInto?.collection === 'templates' ? (
            <p className="lb-note">
              Another design for the same product as{' '}
              <Link to={`/templates/${t.mergedInto.slug}`}>
                {mergedIntoName}
              </Link>
              , so the gallery lists it there. {t.mergedInto.reason}
            </p>
          ) : null}
          {alternates.length > 0 ? (
            <>
              <h2>Other designs for this product</h2>
              <ul className="lb-ticks">
                {alternates.map((a) => (
                  <li key={a.id}>
                    <Link to={`/templates/${a.id}`}>{a.name}</Link>: {a.summary}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {t.patterns ? (
            <>
              <h2>Patterns</h2>
              <ul className="lb-ticks">
                {t.patterns.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : null}
          {t.states ? (
            <>
              <h2>States it is designed for</h2>
              <ul className="lb-ticks">
                {t.states.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
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
            The palette on the 15+ color tokens vibld styles a project with,
            each text color on the fill it is read on.
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

          <h2>Type scale</h2>
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

          {t.guardrails ? (
            <>
              <h2>Guardrails</h2>
              <h3>Experience</h3>
              <ul className="lb-ticks">
                {t.guardrails.ux.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <h3>Accessibility</h3>
              <ul className="lb-ticks">
                {t.guardrails.accessibility.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <h3>Security</h3>
              <ul className="lb-ticks">
                {t.guardrails.security.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : null}

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

/**
 * Screens to add to this design (D110), grouped by the kind of screen each
 * is, up to `max`. The choice goes into the link to the builder.
 */
function ScreenPicker({
  screens,
  chosen,
  max,
  onChange,
}: {
  screens: { id: string; name: string; summary: string; type: string }[];
  chosen: string[];
  max: number;
  onChange: (next: string[]) => void;
}) {
  const types = [...new Set(screens.map((s) => s.type))].sort();
  const full = chosen.length >= max;
  return (
    <details className="lb-tpl-screens">
      <summary>
        Add app screens{chosen.length > 0 ? ` (${chosen.length} chosen)` : ''}
      </summary>
      <p>
        Pick up to {max} screens, such as a dashboard, settings or an empty
        state. Each is built in this design’s own palette and typefaces, with
        its states and guardrails.
      </p>
      {types.map((type) => (
        <fieldset key={type}>
          <legend>
            {type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, ' ')}
          </legend>
          {screens
            .filter((s) => s.type === type)
            .map((s) => {
              const on = chosen.includes(s.id);
              return (
                <label key={s.id}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && full}
                    onChange={() =>
                      onChange(
                        on
                          ? chosen.filter((id) => id !== s.id)
                          : [...chosen, s.id],
                      )
                    }
                  />{' '}
                  <span>
                    <strong>{s.name}</strong>: {s.summary}
                  </span>
                </label>
              );
            })}
        </fieldset>
      ))}
    </details>
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
