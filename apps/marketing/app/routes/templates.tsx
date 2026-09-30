import { useEffect, useMemo, useState } from 'react';
import { Link, useLoaderData, useSearchParams } from 'react-router';

import { PageHead } from '../components/SiteChrome';
import { TemplatePreview } from '../components/TemplatePreview';
import { approxCount } from '../counts';
import { LAYERS } from '../layers';
import { SITE, metaFor } from '../site';
import type { PreviewSpec } from '../template-preview';
import { USE_CASES } from '../use-cases';

export function meta() {
  return metaFor('/templates');
}

export function links() {
  // Every template's typefaces, self-hosted (D104). A face is fetched only
  // when a card that uses it is drawn, and cards past the first page are
  // not drawn until asked for.
  return [{ rel: 'stylesheet', href: '/fonts/templates/faces.css' }];
}

export type TypeStyle = 'serif' | 'sans' | 'mono' | 'display' | 'script';

/** One card's worth of a design, and nothing the card does not draw. */
export interface TemplateCard {
  id: string;
  name: string;
  summary: string;
  kind: 'site' | 'app';
  useCase: string;
  category: string;
  complexity: string;
  /** A whole design, a single page, or a screen pattern (D106, D110). */
  format: string;
  batch: string;
  /** A screen pattern's screen types (D110); empty for a design. */
  screenTypes: string[];
  addedOn: string;
  /** Catalog order, for "Recommended". */
  order: number;
  tone: 'light' | 'dark';
  /** The display face's construction, for the type filter. */
  typeStyle: TypeStyle;
  /** Each family once, with every role it plays in the design. */
  faces: { family: string; roles: string[]; css: string }[];
  preview: PreviewSpec;
}

const TYPE_STYLE: Record<string, TypeStyle> = {
  serif: 'serif',
  'sans-serif': 'sans',
  monospace: 'mono',
  display: 'display',
  handwriting: 'script',
};

const GENERIC: Record<TypeStyle, string> = {
  serif: 'Georgia, serif',
  sans: 'system-ui, sans-serif',
  mono: 'ui-monospace, monospace',
  display: 'system-ui, sans-serif',
  script: 'cursive',
};

/** WCAG relative luminance of a hex colour, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * Read at build time. The catalog is megabytes, so it is imported here, in
 * the loader, which React Router keeps out of the browser bundle; the page
 * gets only what its cards draw.
 */
export async function loader() {
  const {
    listedDesignTemplates,
    DESIGN_TEMPLATES,
    DESIGN_BATCHES,
    SCREEN_TYPES,
  } = await import('@vibld/ai/design-templates');
  const { TEMPLATE_FONTS } = await import('../template-fonts.gen');
  const { previewSpec, fontStack } = await import('../template-preview');
  const styleOf = (family: string): TypeStyle =>
    TYPE_STYLE[TEMPLATE_FONTS[family]?.category ?? ''] ?? 'sans';
  const genericOf = (family: string) => GENERIC[styleOf(family)];
  const cards = listedDesignTemplates().map((t, order): TemplateCard => {
    const display =
      t.style.typeSet.find((f) => f.role === 'display')?.family ??
      t.style.tokens.typography.headingFont;
    const roles = new Map<string, string[]>();
    for (const f of t.style.typeSet) {
      roles.set(f.family, [...(roles.get(f.family) ?? []), f.role]);
    }
    return {
      id: t.id,
      name: t.name,
      summary: t.summary,
      kind: t.kind,
      useCase: t.useCase,
      category: t.category,
      complexity: t.complexity,
      format: t.format,
      batch: t.batch,
      screenTypes: [...(t.screenTypes ?? [])],
      addedOn: t.addedOn,
      order,
      tone:
        luminance(t.style.tokens.colors.background) < 0.2 ? 'dark' : 'light',
      typeStyle: styleOf(display),
      faces: [...roles].map(([family, played]) => ({
        family,
        roles: played,
        css: fontStack(family, genericOf(family)),
      })),
      preview: previewSpec(t, genericOf),
    };
  });
  const nameOf = new Map(DESIGN_TEMPLATES.map((t) => [t.id, t.name]));
  const mergedOf = (collection: 'examples' | 'templates') =>
    DESIGN_TEMPLATES.filter((t) => t.mergedInto?.collection === collection).map(
      (t) => ({
        id: t.id,
        name: t.name,
        into: t.mergedInto!.slug,
        intoName: nameOf.get(t.mergedInto!.slug) ?? t.mergedInto!.slug,
      }),
    );
  return {
    cards,
    merged: mergedOf('examples'),
    alternates: mergedOf('templates'),
    batches: Object.entries(DESIGN_BATCHES).map(([id, b]) => [id, b.name]) as [
      string,
      string,
    ][],
    screenTypes: [...SCREEN_TYPES].sort(),
  };
}

/** "empty-state" as a reader says it: "Empty state". */
export function screenTypeLabel(type: string): string {
  const words = type.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const PAGE = 24;

type Sort = 'recommended' | 'name' | 'newest';

interface Filters {
  q: string;
  /** 'design' (sites and apps, and single pages) or 'screen' (D110). */
  format: string;
  /** A screen type, which shows screens only. */
  screen: string;
  batch: string;
  use: string;
  kind: string;
  tone: string;
  type: string;
  fonts: string;
  sort: Sort;
}

const EMPTY: Filters = {
  q: '',
  format: '',
  screen: '',
  batch: '',
  use: '',
  kind: '',
  tone: '',
  type: '',
  fonts: '',
  sort: 'recommended',
};

function readFilters(params: URLSearchParams): Filters {
  const get = (k: keyof Filters) => params.get(k) ?? '';
  const sort = get('sort');
  return {
    q: get('q'),
    format: get('format'),
    screen: get('screen'),
    batch: get('batch'),
    use: get('use'),
    kind: get('kind'),
    tone: get('tone'),
    type: get('type'),
    fonts: get('fonts'),
    sort: sort === 'name' || sort === 'newest' ? sort : 'recommended',
  };
}

export function matches(card: TemplateCard, f: Filters): boolean {
  if (f.format === 'screen' && card.format !== 'screen') return false;
  if (f.format === 'design' && card.format === 'screen') return false;
  if (
    f.screen &&
    (card.format !== 'screen' ||
      (card.category !== f.screen && !card.screenTypes.includes(f.screen)))
  )
    return false;
  if (f.batch && card.batch !== f.batch) return false;
  if (f.use && card.useCase !== f.use) return false;
  if (f.kind && card.kind !== f.kind) return false;
  if (f.tone && card.tone !== f.tone) return false;
  if (f.type && card.typeStyle !== f.type) return false;
  if (f.fonts) {
    const n = card.faces.length;
    if (f.fonts === '1' && n !== 1) return false;
    if (f.fonts === '2' && n !== 2) return false;
    if (f.fonts === '3' && n < 3) return false;
  }
  if (f.q) {
    const haystack = [
      card.name,
      card.summary,
      card.category,
      ...card.screenTypes,
      ...card.faces.map((face) => face.family),
    ]
      .join(' ')
      .toLowerCase();
    for (const word of f.q.toLowerCase().split(/\s+/).filter(Boolean)) {
      if (!haystack.includes(word)) return false;
    }
  }
  return true;
}

export function sorted(cards: TemplateCard[], sort: Sort): TemplateCard[] {
  const copy = [...cards];
  if (sort === 'name') copy.sort((a, b) => a.name.localeCompare(b.name));
  // The latest batch first: within a day, what was imported later.
  else if (sort === 'newest')
    copy.sort(
      (a, b) => b.addedOn.localeCompare(a.addedOn) || b.order - a.order,
    );
  else copy.sort((a, b) => a.order - b.order);
  return copy;
}

/**
 * The template gallery (D83, D106): every design in the catalog, each card
 * a mocked-up homepage in its own palette and typefaces, filtered and
 * sorted in the page. The filters live in the address, so a filtered view
 * can be shared. Every card is in the prerendered page, for readers and
 * crawlers without script; past the first page they are hidden until asked
 * for, which also keeps their typefaces from loading.
 */
export default function Templates() {
  const { cards, merged, alternates, batches, screenTypes } =
    useLoaderData<typeof loader>();
  const designCount = cards.filter((c) => c.format !== 'screen').length;
  const screenCount = cards.length - designCount;
  const [params, setParams] = useSearchParams();
  // The page is prerendered without a query, so the first render matches it
  // and the address's filters apply once the page is hydrated; applied
  // earlier, a shared filtered link failed hydration.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const filters = hydrated ? readFilters(params) : EMPTY;
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [params]);

  const results = useMemo(
    () =>
      sorted(
        cards.filter((card) => matches(card, filters)),
        filters.sort,
      ),
    [cards, params, hydrated],
  );
  const set = (key: keyof Filters, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== EMPTY[key]) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const filtered = Object.entries(filters).some(
    ([k, v]) => v !== EMPTY[k as keyof Filters],
  );

  return (
    <>
      <PageHead
        eyebrow="Templates"
        title="Designs to start from"
        lead={`${approxCount(designCount)} app and website designs and ${approxCount(screenCount)} app screens to add to them, each with a palette whose every text pair passes WCAG AA and a build prompt a coding agent can follow. Every design has its own typefaces.`}
      />
      <section
        className="lb-section lb-section--tight"
        aria-labelledby="gallery-title"
        id="gallery"
      >
        <div className="lb-wrap">
          <h2 className="visually-hidden" id="gallery-title">
            All designs
          </h2>
          <form
            className="lb-tfilters"
            role="search"
            aria-label="Filter templates"
            onSubmit={(event) => event.preventDefault()}
          >
            <label className="lb-tfilters__search">
              <span>Search</span>
              <input
                type="search"
                value={filters.q}
                placeholder="Name, kind of site, typeface"
                onChange={(event) => set('q', event.target.value)}
              />
            </label>
            <Select
              label="Show"
              value={filters.format}
              onChange={(v) => set('format', v)}
              anyLabel="Designs and screens"
              options={[
                ['design', 'Designs'],
                ['screen', 'App screens'],
              ]}
            />
            <Select
              label="Screen type"
              value={filters.screen}
              onChange={(v) => set('screen', v)}
              options={screenTypes.map((type) => [type, screenTypeLabel(type)])}
            />
            <Select
              label="Use case"
              value={filters.use}
              onChange={(v) => set('use', v)}
              options={USE_CASES.map((u) => [u.slug, u.label])}
            />
            <Select
              label="Kind"
              value={filters.kind}
              onChange={(v) => set('kind', v)}
              options={[
                ['site', 'Websites'],
                ['app', 'Apps'],
              ]}
            />
            <Select
              label="Tone"
              value={filters.tone}
              onChange={(v) => set('tone', v)}
              options={[
                ['light', 'Light'],
                ['dark', 'Dark'],
              ]}
            />
            <Select
              label="Headings in"
              value={filters.type}
              onChange={(v) => set('type', v)}
              options={[
                ['sans', 'Sans serif'],
                ['serif', 'Serif'],
                ['display', 'Display'],
                ['mono', 'Monospace'],
                ['script', 'Handwriting'],
              ]}
            />
            <Select
              label="Typefaces"
              value={filters.fonts}
              onChange={(v) => set('fonts', v)}
              options={[
                ['1', 'One family'],
                ['2', 'A pair'],
                ['3', 'Three or more'],
              ]}
            />
            <Select
              label="Source"
              value={filters.batch}
              onChange={(v) => set('batch', v)}
              options={batches}
            />
            <Select
              label="Sort"
              value={filters.sort}
              onChange={(v) => set('sort', v)}
              anyLabel={null}
              options={[
                ['recommended', 'Recommended'],
                ['newest', 'Newest'],
                ['name', 'A to Z'],
              ]}
            />
          </form>
          <p className="lb-tfilters__count" role="status">
            {results.length === 0
              ? 'No design matches all of these.'
              : filtered
                ? `${approxCount(results.length)} ${results.length === 1 ? 'entry matches' : 'entries match'}.`
                : `${approxCount(results.length)} designs and screens.`}{' '}
            {filtered ? (
              <button
                type="button"
                className="lb-link"
                onClick={() =>
                  setParams(new URLSearchParams(), { replace: true })
                }
              >
                Clear filters
              </button>
            ) : null}
          </p>
          <ul className="lb-tpls lb-tpls--rich">
            {results.map((card, i) => (
              <TemplateCardView key={card.id} card={card} hidden={i >= shown} />
            ))}
          </ul>
          {results.length > shown ? (
            <p className="lb-tfilters__more">
              <button
                type="button"
                className="button"
                onClick={() => setShown((n) => n + PAGE)}
              >
                Show more
              </button>
            </p>
          ) : null}
        </div>
      </section>
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
            one self-contained HTML file.
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
                <Link to={`/examples#example-${m.into}`}>its example</Link>
              </li>
            ))}
          </ul>
          <h3>Another design for the same product</h3>
          <p>
            These are the same product as a design above, so they are shown on
            it as another way to draw it:
          </p>
          <ul className="lb-ticks">
            {alternates.map((m) => (
              <li key={m.id}>
                <Link to={`/templates/${m.id}`}>{m.name}</Link>, on{' '}
                <Link to={`/templates/${m.into}`}>{m.intoName}</Link>
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

function Select({
  label,
  value,
  onChange,
  options,
  anyLabel = 'Any',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
  anyLabel?: string | null;
}) {
  return (
    <label className="lb-tfilters__select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {anyLabel === null ? null : <option value="">{anyLabel}</option>}
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

const ROLE_LABEL: Record<string, string> = {
  display: 'Headings',
  body: 'Body',
  accent: 'Accent',
  mono: 'Figures and code',
  script: 'Handwriting',
  ui: 'Interface',
};

export function TemplateCardView({
  card,
  hidden,
}: {
  card: TemplateCard;
  hidden?: boolean;
}) {
  const single = card.faces.length === 1;
  return (
    <li className="lb-tpl" id={`template-${card.id}`} hidden={hidden}>
      <Link to={`/templates/${card.id}`} className="lb-tpl__link">
        <TemplatePreview spec={card.preview} />
        <div className="lb-tpl__meta">
          <h3>{card.name}</h3>
          <p>{card.summary}</p>
          <ul className="lb-tpl__faces" aria-label="Typefaces">
            {card.faces.map((face) => (
              <li key={face.family}>
                <span style={{ fontFamily: face.css }}>{face.family}</span>
                <small>
                  {single
                    ? 'Everything'
                    : face.roles
                        .map((role) => ROLE_LABEL[role] ?? role)
                        .join(' and ')}
                </small>
              </li>
            ))}
          </ul>
          <p className="lb-tpl__facts">
            {card.format === 'screen'
              ? `App screen · ${screenTypeLabel(card.category)}`
              : `${card.format === 'page' ? 'Single page' : card.kind === 'app' ? 'App' : 'Website'} · ${card.category.replace(/-/g, ' ')}`}
          </p>
        </div>
      </Link>
    </li>
  );
}
