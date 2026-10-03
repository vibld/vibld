import { useState } from 'react';
import { Link, data, useLoaderData } from 'react-router';

import {
  STYLE_CATEGORY_LABELS,
  STYLE_GROUP_LABELS,
} from '@vibld/ai/style-gallery';

import type { Route } from './+types/style';
import { PageHead } from '../components/SiteChrome';
import { SITE, metaFor } from '../site';

/**
 * The id is the last segment: routes.ts declares one path per style. The
 * loader is also asked for `/styles/gallery/<id>.data`, React Router's data
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
  return metaFor(`/styles/gallery/${idOf(location.pathname)}`);
}

export function links() {
  return [{ rel: 'stylesheet', href: '/fonts/templates/faces.css' }];
}

/** One style, read at build time so the gallery stays out of the bundle. */
export async function loader({ request }: Route.LoaderArgs) {
  const { styleGalleryCatalog } = await import('../style-gallery.server');
  const { isDecorativeRole } = await import('@vibld/ai/style-gallery');
  const { contrastRatio } = await import('@vibld/ai/contrast');
  const { fontStack } = await import('../template-preview');
  const { TEMPLATE_FONTS } = await import('../template-fonts.gen');
  const catalog = styleGalleryCatalog();
  const style = catalog.entries.find(
    (entry) => entry.id === idOf(new URL(request.url).pathname),
  );
  if (!style) throw data('Not found', { status: 404 });
  const GENERIC: Record<string, string> = {
    serif: 'Georgia, serif',
    monospace: 'ui-monospace, monospace',
    handwriting: 'cursive',
  };
  const stackOf = (family: string) =>
    fontStack(
      family,
      GENERIC[TEMPLATE_FONTS[family]?.category ?? ''] ??
        'system-ui, sans-serif',
    );
  // The declared faces, then any a type step sets that none of them is.
  const families = [
    ...new Set([
      ...Object.values(style.design_tokens.fonts).filter(Boolean),
      ...style.design_tokens.type_scale.map((step) => step.font),
    ]),
  ];
  // The pair the samples are drawn in: the style's own body text on its
  // canvas, or its first measured text pair.
  const text =
    style.contrast_checks.find(
      (check) => check.target >= 4.5 && /body text/i.test(check.use),
    ) ??
    style.contrast_checks.find(
      (check) => check.target >= 4.5 && !/exempt/i.test(check.use),
    ) ??
    null;
  return {
    style,
    baseline: catalog.baseline_rules_markdown,
    colors: style.design_tokens.colors.map((color) => ({
      ...color,
      decorative: isDecorativeRole(color.role),
    })),
    faces: Object.fromEntries(families.map((f) => [f, stackOf(f)])),
    ink: text?.fg ?? null,
    ground: text?.bg ?? null,
    // Measured here, with vibld's own contrast code, rather than trusted.
    pairs: style.contrast_checks
      .filter(
        (check) =>
          !/exempt/i.test(check.use) &&
          /^#[0-9a-f]{6}$/i.test(check.fg) &&
          /^#[0-9a-f]{6}$/i.test(check.bg),
      )
      .map((check) => ({
        use: check.use,
        fg: check.fg,
        bg: check.bg,
        target: check.target,
        ratio: contrastRatio(check.fg, check.bg) ?? 0,
      })),
  };
}

/**
 * One style from the gallery (D142, D143): its colors, typefaces, type
 * scale, corners and shadows as the builder writes them into a site
 * (D145), every measured pair, and its build prompt in full.
 */
export default function Style() {
  const {
    style: s,
    baseline,
    colors,
    faces,
    ink,
    ground,
    pairs,
  } = useLoaderData<typeof loader>();
  const tokens = s.design_tokens;
  const brief = `${baseline.trim()}\n\n## ${s.name}\n\n${s.build_prompt.trim()}\n`;

  return (
    <>
      <PageHead eyebrow="Style gallery" title={s.name} lead={s.kind}>
        <p className="lb-tpl-facts">
          {s.theme === 'dark' ? 'Dark' : 'Light'} ·{' '}
          {STYLE_CATEGORY_LABELS[s.category]} · {STYLE_GROUP_LABELS[s.group]} ·{' '}
          {s.complexity}
        </p>
      </PageHead>

      <section className="lb-section lb-section--tight" aria-label="The style">
        <div className="lb-wrap lb-tpl-detail">
          <p>{s.purpose}</p>
          <p className="lb-after__cta">
            <a className="button" href={SITE.appUrl}>
              Build in this style
            </a>
            <a className="lb-link" href="#build-prompt">
              Read the build prompt
            </a>
          </p>
          <p className="lb-note">
            In the builder, open <strong>Gallery</strong> under the message and
            search for {s.name}.
          </p>

          <h2>What makes it</h2>
          <ul className="lb-ticks">
            {s.signature.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <h2>Colors</h2>
          <p>{s.visual_style.mood}</p>
          <ul className="lb-tpl-palette" aria-label={`${s.name} colors`}>
            {colors.map((color) => (
              <li key={color.token}>
                <span
                  className="lb-tpl-palette__chip"
                  style={{ background: color.hex }}
                  aria-hidden="true"
                />
                <span>
                  {color.role}
                  {color.decorative ? ', never behind text' : ''}
                </span>
                <code>{color.hex}</code>
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
                        // A 3:1 pair is a line, a ring or large text, so it
                        // is drawn as a mark: no small text on it here.
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

          <h2>Typefaces</h2>
          <p>{s.visual_style.typography.notes}</p>
          <ul className="lb-tpl-typeset">
            {Object.entries(tokens.fonts)
              .filter(([, family]) => Boolean(family))
              .map(([role, family]) => (
                <li key={role}>
                  <span
                    className="lb-tpl-typeset__sample"
                    style={{ fontFamily: faces[family as string] }}
                  >
                    {family}
                  </span>
                  <span>
                    {role === 'display'
                      ? 'Headings'
                      : role === 'body'
                        ? 'Body'
                        : 'Figures and code'}
                  </span>
                </li>
              ))}
          </ul>

          <h2>Type scale</h2>
          <div
            className="lb-style-scale"
            style={
              ink && ground ? { background: ground, color: ink } : undefined
            }
          >
            {[...tokens.type_scale]
              .sort((a, b) => parseFloat(b.size) - parseFloat(a.size))
              .map((step) => (
                <p
                  key={step.token}
                  style={{
                    fontFamily: faces[step.font],
                    fontSize: step.size,
                    fontWeight: step.weight,
                    lineHeight: step.line_height,
                    letterSpacing: step.tracking === '0' ? 0 : step.tracking,
                  }}
                >
                  {step.size} {step.font} {step.weight}
                </p>
              ))}
          </div>

          <h2>Corners and shadows</h2>
          <ul className="lb-style-shapes">
            {Object.entries(tokens.radius).map(([element, radius]) => (
              <li key={element}>
                <span
                  className="lb-style-shapes__box"
                  style={{ borderRadius: radius }}
                  aria-hidden="true"
                />
                <span>
                  {element}: <code>{radius}</code>
                </span>
              </li>
            ))}
            {(tokens.shadows ?? []).map((shadow, i) => (
              <li key={shadow}>
                <span
                  className="lb-style-shapes__box"
                  style={{ boxShadow: shadow }}
                  aria-hidden="true"
                />
                <span>
                  shadow-{i + 1}: <code>{shadow}</code>
                </span>
              </li>
            ))}
          </ul>
          {(tokens.shadows ?? []).length === 0 ? (
            <p>No shadows: depth comes from surfaces and lines.</p>
          ) : null}

          <h2>Spacing and imagery</h2>
          <p>{s.visual_style.spacing}</p>
          <p>{s.visual_style.imagery}</p>

          <h2>Layout</h2>
          <ol className="lb-tpl-list">
            {s.layout.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>

          <h2>Patterns</h2>
          <ul className="lb-ticks">
            {s.patterns.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <h2>Components</h2>
          <ul className="lb-ticks">
            {s.component_specs.map((spec) => (
              <li key={spec.component}>
                <strong>{spec.component}</strong>: {spec.spec}
              </li>
            ))}
          </ul>

          <h2>Interactions and states</h2>
          <ul className="lb-ticks">
            {[...s.interactions, ...s.states].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <h2>Guardrails</h2>
          <h3>Experience</h3>
          <ul className="lb-ticks">
            {s.guardrails.ux.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <h3>Accessibility</h3>
          <ul className="lb-ticks">
            {s.guardrails.accessibility.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <h3>Security</h3>
          <ul className="lb-ticks">
            {s.guardrails.security.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <h2 id="build-prompt">Build prompt</h2>
          <p>
            The rules every style in the gallery assumes, then this style’s own
            ten sections, from goal to guardrails. A build in the style also
            gets its tokens as a file, so the colors and type above are exact.
          </p>
          <CopyButton text={brief} />
          <details className="lb-tpl-baseline">
            <summary>The rules every style assumes</summary>
            <pre>{baseline.trim()}</pre>
          </details>
          <pre className="lb-tpl-prompt">{s.build_prompt.trim()}</pre>

          <p className="lb-after__cta">
            <a className="button" href={SITE.appUrl}>
              Open the builder
            </a>
            <Link className="lb-link" to="/styles/gallery">
              The whole gallery
            </Link>
          </p>
        </div>
      </section>
    </>
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
        Copy the rules and build prompt
      </button>{' '}
      <span role="status">{copied ? 'Copied.' : ''}</span>
    </p>
  );
}
