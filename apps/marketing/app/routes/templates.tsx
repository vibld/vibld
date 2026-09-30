import { Link, useLoaderData } from 'react-router';

import { PageHead } from '../components/SiteChrome';
import { LAYERS } from '../layers';
import { SITE, metaFor } from '../site';
import { USE_CASES } from '../use-cases';

export function meta() {
  return metaFor('/templates');
}

/** One card's worth of a design, and nothing the card does not draw. */
export interface TemplateCard {
  id: string;
  name: string;
  summary: string;
  kind: 'site' | 'app';
  category: string;
  complexity: string;
  /** Page, ink, then the fills, from the design's own tokens. */
  background: string;
  foreground: string;
  swatches: string[];
  headingFont: string;
  bodyFont: string;
}

/**
 * Read at build time. The catalog is 2.6 MB, so it is imported here, in the
 * loader, which React Router keeps out of the browser bundle; the page gets
 * only what its cards draw.
 */
export async function loader() {
  const { listedDesignTemplates, DESIGN_TEMPLATES } =
    await import('@vibld/ai/design-templates');
  const card = (t: (typeof DESIGN_TEMPLATES)[number]): TemplateCard => {
    const c = t.style.tokens.colors;
    return {
      id: t.id,
      name: t.name,
      summary: t.summary,
      kind: t.kind,
      category: t.category,
      complexity: t.complexity,
      background: c.background,
      foreground: c.foreground,
      swatches: [
        ...new Set([c.primary, c.accent, c.secondary, c.muted, c.border]),
      ],
      headingFont: t.style.tokens.typography.headingFont,
      bodyFont: t.style.tokens.typography.bodyFont,
    };
  };
  return {
    total: DESIGN_TEMPLATES.length,
    groups: USE_CASES.map((useCase) => ({
      slug: useCase.slug,
      label: useCase.label,
      cards: listedDesignTemplates({ useCase: useCase.slug as never }).map(
        card,
      ),
    })),
    merged: DESIGN_TEMPLATES.filter((t) => t.mergedInto).map((t) => ({
      id: t.id,
      name: t.name,
      example: t.mergedInto!.slug,
    })),
  };
}

/**
 * The design template catalog (docs/decisions.md, D83): every design from
 * the catalog imported by `packages/ai/bin/import-design-catalog.ts`, filed
 * under the use cases the rest of this site is organised by. A design that
 * is one of vibld's own examples is not listed twice; it is named at the
 * foot of the page and shown on /examples.
 */
export default function Templates() {
  const { total, groups, merged } = useLoaderData<typeof loader>();
  return (
    <>
      <PageHead
        eyebrow="Templates"
        title="Designs to start from"
        lead={`${total} app and website designs, each with a layout, a palette whose every text pair passes WCAG AA, a type pairing, and a build prompt a coding agent can follow. Open one to read all of it.`}
      >
        <nav className="lb-tpl-jump" aria-label="Jump to a use case">
          {groups.map((group) => (
            <a key={group.slug} href={`#${group.slug}`}>
              {group.label} <span>{group.cards.length}</span>
            </a>
          ))}
          <a href="#layers">
            Built from one prompt <span>{LAYERS.length}</span>
          </a>
          <Link to="/inspiration">Palettes and type only</Link>
        </nav>
      </PageHead>
      <section
        className="lb-section lb-section--tight"
        aria-labelledby="layers-title"
        id="layers"
      >
        <div className="lb-wrap">
          <h2 className="lb-h2" id="layers-title">
            Built from one prompt
          </h2>
          <p className="lb-lede">
            A page and a section, each the output of one prompt that asks for
            one self-contained HTML file. Open one for the live page and the
            prompt that made it.
          </p>
          <ul className="lb-tpls lb-tpls--layers">
            {LAYERS.map((layer) => (
              <li
                className="lb-tpl"
                key={layer.slug}
                id={`layer-${layer.slug}`}
              >
                <Link to={`/templates/${layer.slug}`} className="lb-tpl__link">
                  <img
                    className="lb-tpl__shot"
                    src={layer.screenshot}
                    width={1440}
                    height={900}
                    alt=""
                    loading="lazy"
                  />
                  <div className="lb-tpl__meta">
                    <h3>{layer.name}</h3>
                    <p>{layer.summary}</p>
                    <p className="lb-tpl__facts">
                      {layer.kind === 'page' ? 'Landing page' : 'Page section'}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
      {groups.map((group) => (
        <section
          key={group.slug}
          className="lb-section lb-section--tight"
          aria-labelledby={`${group.slug}-title`}
          id={group.slug}
        >
          <div className="lb-wrap">
            <h2 className="lb-h2" id={`${group.slug}-title`}>
              {group.label}
            </h2>
            <p className="lb-lede">
              {group.cards.length} designs.{' '}
              <Link className="lb-link" to={`/use-cases/${group.slug}`}>
                What to ask vibld for
              </Link>
            </p>
            <ul className="lb-tpls">
              {group.cards.map((card) => (
                <TemplateCardView key={card.id} card={card} />
              ))}
            </ul>
          </div>
        </section>
      ))}
      <section className="lb-section" aria-labelledby="merged-title">
        <div className="lb-wrap">
          <h2 className="lb-h2" id="merged-title">
            Already built by vibld
          </h2>
          <p className="lb-lede">
            These designs are the same product as one of vibld’s own examples,
            so they are shown there, beside the site vibld generated:
          </p>
          <ul className="lb-ticks">
            {merged.map((m) => (
              <li key={m.id}>
                <Link to={`/templates/${m.id}`}>{m.name}</Link>, on{' '}
                <Link to={`/examples#example-${m.example}`}>its example</Link>
              </li>
            ))}
          </ul>
          <p className="lb-after__cta">
            <a className="button" href={SITE.appUrl}>
              Open the builder
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

export function TemplateCardView({ card }: { card: TemplateCard }) {
  return (
    <li className="lb-tpl" id={`template-${card.id}`}>
      <Link to={`/templates/${card.id}`} className="lb-tpl__link">
        <div
          className="lb-tpl__sample"
          // The design's own ink on its own page, a pair the catalog checked.
          style={{ background: card.background, color: card.foreground }}
        >
          <span className="lb-tpl__aa" aria-hidden="true">
            Aa
          </span>
          <ul className="lb-tpl__strip" aria-hidden="true">
            {card.swatches.map((hex) => (
              <li key={hex} style={{ background: hex }} />
            ))}
          </ul>
        </div>
        <div className="lb-tpl__meta">
          <h3>{card.name}</h3>
          <p>{card.summary}</p>
          <p className="lb-tpl__facts">
            {card.kind === 'app' ? 'App' : 'Website'} · {card.headingFont}
            {card.bodyFont !== card.headingFont ? ` / ${card.bodyFont}` : ''}
          </p>
        </div>
      </Link>
    </li>
  );
}
