import { useMemo, useState } from 'react';
import { Link, useLoaderData } from 'react-router';

import {
  STYLE_CATEGORY_LABELS,
  STYLE_GALLERY_CATEGORIES,
  STYLE_GALLERY_GROUPS,
  STYLE_GROUP_LABELS,
} from '@vibld/ai/style-gallery';
import { STYLE_GALLERY_INDEX } from '@vibld/ai/style-gallery-index';

import { PageHead } from '../components/SiteChrome';
import { approxCount } from '../counts';
import { SITE, metaFor } from '../site';

export function meta() {
  return metaFor('/styles/gallery');
}

export function links() {
  // Each style's typefaces, self-hosted (D104). A face is fetched only when
  // a card that uses it is drawn.
  return [{ rel: 'stylesheet', href: '/fonts/templates/faces.css' }];
}

/** What a card draws that the name index does not hold. */
export interface StyleSample {
  /** One measured text pair: the sample is drawn only in it. */
  ink: string;
  ground: string;
  /** The palette, decorative colors last. */
  strip: string[];
  display: string;
}

/**
 * Every style's sample, read at build time so the gallery stays out of the
 * bundle. Names, themes and groups come from the index every page has.
 */
export async function loader() {
  const { styleGalleryCatalog } = await import('../style-gallery.server');
  const { isDecorativeRole } = await import('@vibld/ai/style-gallery');
  const { fontStack } = await import('../template-preview');
  const { TEMPLATE_FONTS } = await import('../template-fonts.gen');
  const samples: Record<string, StyleSample> = {};
  for (const entry of styleGalleryCatalog().entries) {
    const pair =
      entry.contrast_checks.find(
        (check) => check.target >= 4.5 && !/exempt/i.test(check.use),
      ) ?? null;
    const colors = entry.design_tokens.colors;
    const family = entry.design_tokens.fonts.display;
    samples[entry.id] = {
      ink: pair?.fg ?? '',
      ground: pair?.bg ?? '',
      strip: [
        ...colors.filter((c) => !isDecorativeRole(c.role)),
        ...colors.filter((c) => isDecorativeRole(c.role)),
      ].map((c) => c.hex),
      display: fontStack(
        family,
        TEMPLATE_FONTS[family]?.category === 'serif'
          ? 'Georgia, serif'
          : 'system-ui, sans-serif',
      ),
    };
  }
  return { samples };
}

const PAGE = 48;

/**
 * The style gallery (D142, D143): every style, filtered by theme, look and
 * industry and searched by name, each linking to its own page.
 */
export default function StyleGallery() {
  const { samples } = useLoaderData<typeof loader>();
  const [theme, setTheme] = useState('');
  const [category, setCategory] = useState('');
  const [group, setGroup] = useState('');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);

  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return STYLE_GALLERY_INDEX.filter(
      (style) =>
        (!theme || style.theme === theme) &&
        (!category || style.category === category) &&
        (!group || style.group === group) &&
        words.every((word) =>
          [
            style.name,
            STYLE_CATEGORY_LABELS[style.category],
            STYLE_GROUP_LABELS[style.group],
            style.theme,
          ]
            .join(' ')
            .toLowerCase()
            .includes(word),
        ),
    );
  }, [theme, category, group, query]);
  const filtered = Boolean(theme || category || group || query);
  const reset = (apply: () => void) => {
    apply();
    setShown(PAGE);
  };

  return (
    <>
      <PageHead
        eyebrow="Styles"
        title="The style gallery"
        lead={`${approxCount(STYLE_GALLERY_INDEX.length)} complete visual systems to build in: colors with every text pair measured, typefaces, a type scale, corners and shadows, and a build prompt. In the builder, choose one under Gallery.`}
      />
      <section
        className="lb-section lb-section--tight"
        aria-labelledby="gallery-title"
      >
        <div className="lb-wrap">
          <h2 className="visually-hidden" id="gallery-title">
            All styles
          </h2>
          <form
            className="lb-tfilters"
            role="search"
            aria-label="Filter styles"
            onSubmit={(event) => event.preventDefault()}
          >
            <label className="lb-tfilters__search">
              <span>Search</span>
              <input
                type="search"
                value={query}
                placeholder="Name, look or industry"
                onChange={(event) => reset(() => setQuery(event.target.value))}
              />
            </label>
            <Select
              label="Theme"
              value={theme}
              onChange={(v) => reset(() => setTheme(v))}
              anyLabel="Light or dark"
              options={[
                ['light', 'Light'],
                ['dark', 'Dark'],
              ]}
            />
            <Select
              label="Look"
              value={category}
              onChange={(v) => reset(() => setCategory(v))}
              anyLabel="Every look"
              options={STYLE_GALLERY_CATEGORIES.map((c) => [
                c,
                STYLE_CATEGORY_LABELS[c],
              ])}
            />
            <Select
              label="Industry"
              value={group}
              onChange={(v) => reset(() => setGroup(v))}
              anyLabel="Every industry"
              options={STYLE_GALLERY_GROUPS.map((g) => [
                g,
                STYLE_GROUP_LABELS[g],
              ])}
            />
          </form>
          <p className="lb-tfilters__count" role="status">
            {results.length === 0
              ? 'No style matches all of these.'
              : filtered
                ? `${approxCount(results.length)} ${results.length === 1 ? 'style matches' : 'styles match'}.`
                : `${approxCount(results.length)} styles.`}{' '}
            {filtered ? (
              <button
                type="button"
                className="lb-link"
                onClick={() =>
                  reset(() => {
                    setTheme('');
                    setCategory('');
                    setGroup('');
                    setQuery('');
                  })
                }
              >
                Clear filters
              </button>
            ) : null}
          </p>
          <ul className="lb-tpls">
            {results.slice(0, shown).map((style) => {
              const sample = samples[style.id];
              return (
                <li className="lb-tpl" key={style.id}>
                  <Link
                    to={`/styles/gallery/${style.id}`}
                    className="lb-tpl__link"
                  >
                    {sample ? (
                      <div
                        className="lb-tpl__sample"
                        style={{
                          background: sample.ground,
                          color: sample.ink,
                        }}
                      >
                        <span
                          className="lb-tpl__aa"
                          style={{ fontFamily: sample.display }}
                        >
                          Aa
                        </span>
                        <ul className="lb-tpl__strip" aria-hidden="true">
                          {sample.strip.slice(0, 6).map((hex, i) => (
                            <li
                              key={`${hex}-${i}`}
                              style={{ background: hex }}
                            />
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <div className="lb-tpl__meta">
                      <h3>{style.name}</h3>
                      <p className="lb-tpl__facts">
                        {style.theme === 'dark' ? 'Dark' : 'Light'} ·{' '}
                        {STYLE_CATEGORY_LABELS[style.category]} ·{' '}
                        {STYLE_GROUP_LABELS[style.group]}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
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
          <p className="lb-after__cta">
            <a className="button" href={SITE.appUrl}>
              Open the builder
            </a>
            <Link className="lb-link" to="/styles">
              Named styles and moving backgrounds
            </Link>
            <Link className="lb-link" to="/templates">
              Templates
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
  anyLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
  anyLabel: string;
}) {
  return (
    <label className="lb-tfilters__select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{anyLabel}</option>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
