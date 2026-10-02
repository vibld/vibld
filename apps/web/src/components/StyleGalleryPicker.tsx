import { useEffect, useId, useMemo, useState } from 'react';

import {
  STYLE_CATEGORY_LABELS,
  STYLE_GALLERY_CATEGORIES,
  STYLE_GALLERY_GROUPS,
  STYLE_GALLERY_THEMES,
  STYLE_GROUP_LABELS,
  filterStyleCards,
  isDecorativeRole,
} from '@vibld/ai/style-gallery';
import type {
  StyleCard,
  StyleGalleryCategory,
  StyleGalleryGroup,
  StyleGalleryTheme,
} from '@vibld/ai/style-gallery';

import type { StyleColorEdits } from '@vibld/ai/style-gallery';

import { loadStyleCards } from '../generation/style-gallery-client.ts';
import { StyleColorEditor } from './StyleColorEditor.tsx';

/** Cards shown at once, and how many more each "Show more" adds. */
export const PAGE = 24;

/**
 * The style gallery (docs/decisions.md, D142, D144): website styles, each a
 * whole design system, filtered by theme, aesthetic and industry and
 * searched by name, descriptor, tags and signature moves. A card shows the
 * palette and the display and body faces. Choosing one is a project
 * setting, like the style preset it replaces.
 *
 * The cards load when the panel first opens, not with the builder.
 */
export function StyleGalleryPicker({
  active,
  value,
  onChange,
  disabled,
  colors = null,
  onColorsChange,
  loader = loadStyleCards,
}: {
  /** The panel is open. */
  active: boolean;
  /** The chosen style's id, or null for none. */
  value: string | null;
  onChange: (id: string | null) => void;
  disabled: boolean;
  /** The chosen style's color edits (D147), offered where they are held. */
  colors?: StyleColorEdits | null;
  onColorsChange?: (edits: StyleColorEdits | null) => void;
  /** For tests. */
  loader?: typeof loadStyleCards;
}) {
  const [cards, setCards] = useState<StyleCard[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [theme, setTheme] = useState<StyleGalleryTheme | ''>('');
  const [category, setCategory] = useState<StyleGalleryCategory | ''>('');
  const [group, setGroup] = useState<StyleGalleryGroup | ''>('');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const ids = {
    theme: useId(),
    category: useId(),
    group: useId(),
    query: useId(),
  };

  useEffect(() => {
    if (!active || cards || failure) return;
    let live = true;
    void loader().then((result) => {
      if (!live) return;
      if (result.ok) setCards(result.cards);
      else setFailure(result.message);
    });
    return () => {
      live = false;
    };
  }, [active, cards, failure, loader]);

  const matches = useMemo(
    () =>
      cards ? filterStyleCards(cards, { theme, category, group, query }) : [],
    [cards, theme, category, group, query],
  );
  // A narrower search starts from the top again.
  useEffect(() => setShown(PAGE), [theme, category, group, query]);
  // A style a later import removed reads as none (migration 0045): once the
  // gallery has loaded, a saved id it does not have is cleared.
  useEffect(() => {
    if (cards && value && !cards.some((card) => card.id === value)) {
      onChange(null);
    }
  }, [cards, value, onChange]);

  if (failure) {
    return (
      <div className="gallery">
        <p className="option-panel__about" role="alert">
          {failure}
        </p>
        <button
          type="button"
          className="button"
          onClick={() => setFailure(null)}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!cards) {
    return <p className="option-panel__about">Loading styles…</p>;
  }
  if (cards.length === 0) {
    return (
      <p className="option-panel__about">
        This copy of vibld has no style gallery.
      </p>
    );
  }

  const chosen = value ? cards.find((card) => card.id === value) : null;

  return (
    <div className="gallery">
      {value ? (
        <p className="styles__chosen">
          Building in <strong>{chosen?.name ?? value}</strong>.{' '}
          <button
            type="button"
            className="linkbutton"
            onClick={() => onChange(null)}
            disabled={disabled}
          >
            Clear
          </button>
        </p>
      ) : null}
      {value && onColorsChange ? (
        <StyleColorEditor
          styleId={value}
          value={colors}
          onChange={onColorsChange}
          disabled={disabled}
        />
      ) : null}
      <div className="gallery__filters">
        <div>
          <label className="option-panel__label" htmlFor={ids.theme}>
            Theme
          </label>
          <select
            id={ids.theme}
            className="prompt__input"
            value={theme}
            onChange={(event) =>
              setTheme(event.target.value as StyleGalleryTheme | '')
            }
          >
            <option value="">Light or dark</option>
            {STYLE_GALLERY_THEMES.map((t) => (
              <option key={t} value={t}>
                {t === 'light' ? 'Light' : 'Dark'}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="option-panel__label" htmlFor={ids.category}>
            Aesthetic
          </label>
          <select
            id={ids.category}
            className="prompt__input"
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as StyleGalleryCategory | '')
            }
          >
            <option value="">Every aesthetic</option>
            {STYLE_GALLERY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {STYLE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="option-panel__label" htmlFor={ids.group}>
            Industry
          </label>
          <select
            id={ids.group}
            className="prompt__input"
            value={group}
            onChange={(event) =>
              setGroup(event.target.value as StyleGalleryGroup | '')
            }
          >
            <option value="">Every industry</option>
            {STYLE_GALLERY_GROUPS.map((g) => (
              <option key={g} value={g}>
                {STYLE_GROUP_LABELS[g]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="option-panel__label" htmlFor={ids.query}>
            Search
          </label>
          <input
            id={ids.query}
            type="search"
            className="prompt__input"
            value={query}
            placeholder="serif, pill corners, mono…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <p className="option-panel__about" role="status">
        {matches.length === 0
          ? 'No style matches.'
          : matches.length === 1
            ? '1 style matches.'
            : `${matches.length} styles match.`}
      </p>
      <ul className="gallery__grid" aria-label="Styles">
        {matches.slice(0, shown).map((card) => {
          const on = card.id === value;
          return (
            <li key={card.id}>
              <button
                type="button"
                className={`gallery__card${on ? ' gallery__card--on' : ''}`}
                aria-pressed={on}
                disabled={disabled}
                // Choosing the chosen card again clears it, as a style chip
                // does.
                onClick={() => onChange(on ? null : card.id)}
              >
                <span className="gallery__swatches" aria-hidden="true">
                  {card.palette.map((swatch) => (
                    <span
                      key={`${swatch.role}${swatch.hex}`}
                      className={`gallery__swatch${
                        isDecorativeRole(swatch.role)
                          ? ' gallery__swatch--decorative'
                          : ''
                      }`}
                      style={{ background: swatch.hex }}
                      title={`${swatch.role} ${swatch.hex}`}
                    />
                  ))}
                </span>
                <span className="gallery__name">{card.name}</span>
                <span className="gallery__kind">{card.kind}</span>
                <span className="gallery__fonts">
                  {card.fonts.display === card.fonts.body
                    ? card.fonts.display
                    : `${card.fonts.display} / ${card.fonts.body}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {matches.length > shown ? (
        <button
          type="button"
          className="button"
          onClick={() => setShown(shown + PAGE)}
        >
          Show more
        </button>
      ) : null}
    </div>
  );
}
