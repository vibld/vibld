import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  Link,
  useLoaderData,
  useLocation,
  useSearchParams,
} from 'react-router';

import {
  TEMPLATE_GROUPS,
  TEMPLATE_SUBCATEGORIES,
  findSubcategory,
  subcategoryPhrase,
  subcategoryTitle,
  type TemplateGroup,
} from '@vibld/ai/design-categories';

import { PageHead } from '../components/SiteChrome';
import { TemplatePreview } from '../components/TemplatePreview';
import { approxCount } from '../counts';
import { LAYERS } from '../layers';
import { SITE, metaFor } from '../site';
import { STYLE_BATCH } from '../style-cards';
import type { PreviewSpec } from '../template-preview';
import { placeHref, placeOf, placePath, type Place } from '../template-places';

export { placeOf, placePath, type Place };

export function meta({ location }: { location: { pathname: string } }) {
  return metaFor(placePath(placeOf(location.pathname)));
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
  /** Its own page: a design's under /templates, a style's in the gallery. */
  href: string;
  name: string;
  summary: string;
  kind: 'site' | 'app';
  /** Websites, apps or app screens (D161). */
  group: TemplateGroup;
  /** Its subcategories' slugs, in gallery order (D161). */
  subcategories: string[];
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
  /** Absent on a style card past the first page, which fetches it. */
  preview?: PreviewSpec;
  /** The style-cards file its preview is in (app/style-cards.ts). */
  visuals?: number;
}

/**
 * Read at build time. The catalog is megabytes, so it is imported here, in
 * the loader, which React Router keeps out of the browser bundle; the page
 * gets only what its cards draw.
 */
export async function loader({ request }: { request: Request }) {
  // A client navigation asks for `<path>.data`, and that is the URL the
  // loader is handed.
  const place = placeOf(new URL(request.url).pathname.replace(/\.data$/, ''));
  const { templateCatalog } = await import('../template-cards.server');
  const { cards, ...rest } = await templateCatalog();
  return {
    place,
    ...rest,
    // Every card is listed, so search and the filters reach them all, but
    // a style's preview ships only on the first page (D162).
    cards: cards
      .filter((card) => inPlace(card, place))
      .map((card, i): TemplateCard => {
        if (i < PAGE || card.visuals === undefined) return card;
        const { preview: _drawn, ...listed } = card;
        return listed;
      }),
  };
}

export function inPlace(
  card: Pick<TemplateCard, 'group' | 'subcategories'>,
  place: Place,
): boolean {
  if (place.group && card.group !== place.group) return false;
  return !place.sub || card.subcategories.includes(place.sub);
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
  /** A screen type, which shows screens only. */
  screen: string;
  batch: string;
  tone: string;
  type: string;
  fonts: string;
  sort: Sort;
}

const EMPTY: Filters = {
  q: '',
  screen: '',
  batch: '',
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
    screen: get('screen'),
    batch: get('batch'),
    tone: get('tone'),
    type: get('type'),
    fonts: get('fonts'),
    sort: sort === 'name' || sort === 'newest' ? sort : 'recommended',
  };
}

export function matches(card: TemplateCard, f: Filters): boolean {
  if (
    f.screen &&
    (card.format !== 'screen' ||
      (card.category !== f.screen && !card.screenTypes.includes(f.screen)))
  )
    return false;
  if (f.batch && card.batch !== f.batch) return false;
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
      ...card.subcategories.map(
        (sub) => findSubcategory(card.group, sub)?.label ?? sub,
      ),
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
 * can be shared. Every design's card is in the prerendered page, for
 * readers and crawlers without script; past the first page they are hidden
 * until asked for, which also keeps their typefaces from loading. The style
 * gallery's entries, listed after them (D162), are drawn only as far as
 * the reader has asked.
 */
export default function Templates() {
  const { place, counts, cards, merged, alternates, batches, screenTypes } =
    useLoaderData<typeof loader>();
  const designCount = (counts.websites ?? 0) + (counts.apps ?? 0);
  const screenCount = counts.screens ?? 0;
  const head = placeHead(place, counts);
  const showScreenTypes = !place.group || place.group === 'screens';
  const [params, setParams] = useSearchParams();
  // The page is prerendered without a query, so the first render matches it
  // and the address's filters apply once the page is hydrated; applied
  // earlier, a shared filtered link failed hydration.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const filters = hydrated ? readFilters(params) : EMPTY;
  // How many cards are drawn, for the filters it was counted under: new
  // filters start from one page in the same render, so nothing below fetches
  // previews for cards that render is about to hide.
  const where = params.toString();
  const [page, setPage] = useState({ where, shown: PAGE });
  const shown = page.where === where ? page.shown : PAGE;
  // The previews of the style cards in view, fetched a file at a time.
  const [drawn, setDrawn] = useState<Record<string, PreviewSpec>>({});
  const asked = useRef(new Set<number>());

  const results = useMemo(
    () =>
      sorted(
        cards.filter((card) => matches(card, filters)),
        filters.sort,
      ),
    [cards, params, hydrated],
  );
  useEffect(() => {
    for (const card of results.slice(0, shown)) {
      const n = card.visuals;
      if (card.preview || n === undefined || asked.current.has(n)) continue;
      asked.current.add(n);
      fetch(`/templates/style-cards/${n}.json`)
        .then((response) => (response.ok ? response.json() : {}))
        .then((got: Record<string, PreviewSpec>) =>
          setDrawn((had) => ({ ...had, ...got })),
        )
        // Asked again when the reader next reaches a card in it.
        .catch(() => asked.current.delete(n));
    }
  }, [results, shown]);
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
        title={head.title}
        lead={
          place.group
            ? head.lead
            : `${approxCount(designCount)} app and website designs and ${approxCount(screenCount)} app screens to add to them, each with a palette whose every text pair passes WCAG AA and a build prompt a coding agent can follow. Every design has its own typefaces.`
        }
      >
        <CategoryNav place={place} counts={counts} />
      </PageHead>
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
            {showScreenTypes ? (
              <Select
                label="Screen type"
                value={filters.screen}
                onChange={(v) => set('screen', v)}
                options={screenTypes.map((type) => [
                  type,
                  screenTypeLabel(type),
                ])}
              />
            ) : null}
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
                : `${approxCount(results.length)} ${head.noun}.`}{' '}
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
            {results.map((card, i) =>
              // A style past the first pages is drawn only when asked for:
              // every one has its own page, linked from the gallery, and
              // drawing them all would make this page megabytes (D162).
              i >= shown && card.batch === STYLE_BATCH ? null : (
                <TemplateCardView
                  key={card.id}
                  card={card}
                  preview={card.preview ?? drawn[card.id]}
                  hidden={i >= shown}
                />
              ),
            )}
          </ul>
          {results.length > shown ? (
            <p className="lb-tfilters__more">
              <button
                type="button"
                className="button"
                onClick={() => setPage({ where, shown: shown + PAGE })}
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
  preview = card.preview,
  hidden,
}: {
  card: TemplateCard;
  preview?: PreviewSpec;
  hidden?: boolean;
}) {
  const single = card.faces.length === 1;
  return (
    <li className="lb-tpl" id={`template-${card.id}`} hidden={hidden}>
      <Link to={card.href} className="lb-tpl__link">
        {preview ? (
          <TemplatePreview spec={preview} />
        ) : (
          <div className="tp" aria-hidden="true">
            <div className="tp__page" />
          </div>
        )}
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
              : `${card.format === 'page' ? 'Single page' : card.kind === 'app' ? 'App' : 'Website'} · ${card.subcategories.map((sub) => findSubcategory(card.group, sub)?.label ?? sub).join(', ')}`}
          </p>
        </div>
      </Link>
    </li>
  );
}

/** The heading, lead and noun for a place in the catalog (D161). */
export function placeHead(
  place: Place,
  counts: Record<string, number>,
): { title: string; lead: string; noun: string } {
  const group = TEMPLATE_GROUPS.find((g) => g.slug === place.group);
  if (!group) {
    return {
      title: 'Designs to start from',
      lead: '',
      noun: 'designs and screens',
    };
  }
  const sub = place.sub ? findSubcategory(group.slug, place.sub) : undefined;
  const n =
    counts[place.sub ? `${place.group}/${place.sub}` : place.group] ?? 0;
  const things =
    group.slug === 'screens'
      ? 'app screens'
      : `${group.noun} ${n === 1 ? 'design' : 'designs'}`;
  const lead =
    group.slug === 'screens'
      ? `${approxCount(n)} app screens, such as dashboards, settings pages and empty states, to add to any app design. Each one is built in the design system of the template it joins.`
      : `${approxCount(n)} ${sub ? `${subcategoryPhrase(sub)} ` : ''}${things}, ${n === 1 ? 'with' : 'each with'} a palette whose every text pair passes WCAG AA, its own typefaces and a build prompt to start a project from.`;
  return {
    title: sub
      ? subcategoryTitle(sub)
      : `${group.noun.charAt(0).toUpperCase()}${group.noun.slice(1)} templates`,
    lead,
    noun: things,
  };
}

/**
 * The categories and subcategories as links (D161), the way
 * lovable.dev/templates lays out its own: every place is a page of its own,
 * and the filters in the address go with you between them.
 */
function CategoryNav({
  place,
  counts,
}: {
  place: Place;
  counts: Record<string, number>;
}) {
  const { search } = useLocation();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  // As prerendered, the links carry no query; the address's own applies once
  // hydrated, as the filters do. A screen type goes only where screens are
  // listed: elsewhere it would hide every card behind a filter not shown.
  const to = (p: Place) => placeHref(p, hydrated ? search : '');
  // Every subcategory on /templates, by category; a category's own on its
  // pages. App screens are sorted by screen type in the filters instead.
  const rows = TEMPLATE_GROUPS.filter(
    (g) => g.slug !== 'screens' && (!place.group || g.slug === place.group),
  ).map((g) => ({
    label: place.group ? 'Subcategory' : g.label,
    subs: TEMPLATE_SUBCATEGORIES.filter((sub) => sub.group === g.slug),
  }));
  const link = (p: Place, label: string, count?: number) => {
    const current = p.group === place.group && p.sub === place.sub;
    return (
      <li key={placePath(p)}>
        <Link
          to={to(p)}
          aria-current={current ? 'page' : undefined}
          preventScrollReset
        >
          {label}
          {count === undefined ? null : <small>{approxCount(count)}</small>}
        </Link>
      </li>
    );
  };
  return (
    <nav className="lb-tcats" aria-label="Template categories">
      <p className="lb-tcats__label">Category</p>
      <ul className="lb-chiplinks">
        {link({ group: '', sub: '' }, 'All')}
        {TEMPLATE_GROUPS.map((g) =>
          link({ group: g.slug, sub: '' }, g.label, counts[g.slug]),
        )}
      </ul>
      {rows.map((row) => (
        <Fragment key={row.label}>
          <p className="lb-tcats__label">{row.label}</p>
          <ul className="lb-chiplinks">
            {row.subs.map((sub) =>
              link(
                { group: sub.group, sub: sub.slug },
                sub.label,
                counts[`${sub.group}/${sub.slug}`],
              ),
            )}
          </ul>
        </Fragment>
      ))}
    </nav>
  );
}
