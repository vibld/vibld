import { useEffect, useId, useRef, useState } from 'react';

import {
  TEMPLATE_GROUPS,
  TEMPLATE_SUBCATEGORIES,
  styleSubcategory,
  templateGroup,
  templateSubcategories,
} from '@vibld/ai/design-categories';
import {
  STYLE_CATEGORY_LABELS,
  STYLE_GROUP_LABELS,
} from '@vibld/ai/style-gallery';

import { loadTemplateBrief } from '../templates/template-brief-client.ts';

/** How many cards the picker draws at once; "Show more" adds as many. */
const PAGE = 60;

/** One entry the picker lists: a design template or a style (D162). */
interface Entry {
  id: string;
  name: string;
  summary: string;
  group: string;
  subcategories: string[];
}

/**
 * Whether this build wrote the styles' briefs. A copy built without the
 * gallery's data writes none (scripts/template-assets.ts), so it lists no
 * styles rather than ones that cannot be added. Unset outside a Vite build,
 * as in the tests.
 */
const STYLES_BUILT =
  typeof __VIBLD_STYLE_GALLERY__ === 'undefined' || __VIBLD_STYLE_GALLERY__;

/**
 * Every listed design, then every style gallery entry under the website
 * subcategory its industry names (D162), as vibld.com/templates lists them.
 */
async function loadEntries(withStyles: boolean): Promise<Entry[]> {
  const [designs, styles] = await Promise.all([
    import('@vibld/ai/design-template-index'),
    withStyles
      ? import('@vibld/ai/style-gallery-index')
      : { STYLE_GALLERY_INDEX: [] },
  ]);
  return [
    ...designs.DESIGN_TEMPLATE_INDEX.filter((t) => !t.mergedInto).map(
      (t): Entry => ({
        id: t.id,
        name: t.name,
        summary: t.summary,
        group: templateGroup(t),
        subcategories: templateSubcategories(t).map((sub) => sub.slug),
      }),
    ),
    ...styles.STYLE_GALLERY_INDEX.map((style): Entry => ({
      id: style.id,
      name: style.name,
      summary: `${STYLE_CATEGORY_LABELS[style.category]} style for ${STYLE_GROUP_LABELS[style.group]} sites, ${style.theme} theme`,
      group: 'websites',
      subcategories: [styleSubcategory(style.group)?.slug ?? ''],
    })),
  ];
}

/**
 * Whether a design is in a place as vibld.com/templates names it (D161): a
 * category, `websites`, or a subcategory, `websites/ecommerce`.
 */
function inCategory(entry: Entry, place: string): boolean {
  if (!place) return true;
  const [group, sub] = place.split('/');
  if (entry.group !== group) return false;
  return !sub || entry.subcategories.includes(sub);
}

/**
 * A design template as inspiration (docs/decisions.md, D148): the template
 * catalog vibld.com shows, searchable here, and the chosen template's brief
 * added to the message as text, as "Start from this template" on vibld.com
 * fills it (D106). What a build is asked for stays in view and can be
 * edited.
 *
 * The style gallery's entries are listed too, each a website under its
 * industry's subcategory, and add their own build prompt the same way
 * (D162).
 *
 * The names load when the panel first opens; a brief loads when it is
 * added, one at a time, because the catalog itself is far too large to ship
 * to the builder.
 */
export function TemplatePicker({
  active,
  disabled,
  message,
  room,
  onAdd,
  loader = loadTemplateBrief,
  withStyles = STYLES_BUILT,
}: {
  /** The panel is open. */
  active: boolean;
  disabled: boolean;
  /** The message as it is now. */
  message: string;
  /** How many characters the message has left. */
  room: number;
  onAdd: (text: string) => void;
  /** For tests. */
  loader?: (id: string) => ReturnType<typeof loadTemplateBrief>;
  /** For tests: list the style gallery's entries. */
  withStyles?: boolean;
}) {
  const [index, setIndex] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [chosen, setChosen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const categoryId = useId();
  const searchId = useId();
  // The message as it is now, read when a brief arrives: one sent or edited
  // while the brief loaded is not the message it was asked for.
  const latest = useRef(message);
  latest.current = message;

  useEffect(() => {
    if (!active || index) return;
    let live = true;
    loadEntries(withStyles).then(
      (entries) => {
        if (live) setIndex(entries);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [active, index, withStyles]);

  if (failed) {
    return (
      <p className="option-panel__about" role="alert">
        The templates could not be loaded. Reload the page to try again.
      </p>
    );
  }
  if (!index) {
    return <p className="option-panel__about">Loading templates…</p>;
  }

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = index.filter(
    (template) =>
      inCategory(template, category) &&
      words.every((word) =>
        `${template.name} ${template.summary}`.toLowerCase().includes(word),
      ),
  );

  // The catalog runs to thousands with the styles: drawing every card at
  // once would mount them all in the composer.
  const visible = shown.slice(0, limit);

  // A choice the filters hide is no choice: what is added is what is seen.
  const selected =
    chosen !== null && visible.some((template) => template.id === chosen)
      ? chosen
      : null;

  const add = async (id: string) => {
    setAdding(true);
    setProblem(null);
    const before = latest.current;
    const result = await loader(id);
    setAdding(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    if (latest.current !== before) {
      setProblem(
        'The message changed while the template loaded. Add it again.',
      );
      return;
    }
    // Leave room for the blank line between the message and the brief.
    if (result.brief.length > room - 2) {
      setProblem(
        "That template's brief is longer than what the message has left. Shorten the message, then add it again.",
      );
      return;
    }
    onAdd(result.brief);
    setChosen(null);
  };

  return (
    <div className="gallery">
      <div className="gallery__filters">
        <div>
          <label className="option-panel__label" htmlFor={categoryId}>
            Category
          </label>
          <select
            id={categoryId}
            className="prompt__input"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setLimit(PAGE);
            }}
            disabled={disabled}
          >
            <option value="">Everything</option>
            {TEMPLATE_GROUPS.map((group) => (
              <optgroup key={group.slug} label={group.label}>
                <option value={group.slug}>
                  All {group.label.toLowerCase()}
                </option>
                {TEMPLATE_SUBCATEGORIES.filter(
                  (sub) => sub.group === group.slug,
                ).map((sub) => (
                  <option key={sub.slug} value={`${group.slug}/${sub.slug}`}>
                    {sub.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="option-panel__label" htmlFor={searchId}>
            Search
          </label>
          <input
            id={searchId}
            type="search"
            className="prompt__input"
            value={query}
            placeholder="Name or what it is"
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(PAGE);
            }}
            disabled={disabled}
          />
        </div>
      </div>
      <ul className="gallery__grid" aria-label="Templates">
        {visible.map((template) => {
          const on = chosen === template.id;
          return (
            <li key={template.id}>
              <button
                type="button"
                className={`gallery__card${on ? ' gallery__card--on' : ''}`}
                aria-pressed={on}
                // The brief being added is the one chosen: no other until
                // it arrives.
                disabled={disabled || adding}
                onClick={() => {
                  setProblem(null);
                  setChosen(on ? null : template.id);
                }}
              >
                <span className="gallery__name">{template.name}</span>
                <span className="gallery__kind">{template.summary}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {shown.length > visible.length ? (
        <button
          type="button"
          className="button button--small"
          onClick={() => setLimit((had) => had + PAGE)}
        >
          Show more
        </button>
      ) : null}
      <p className="option-panel__about" role="status">
        {shown.length === 0
          ? 'No template matches.'
          : selected
            ? 'Its brief is added to your message, to edit or send.'
            : 'Choose one to start from.'}
      </p>
      {problem ? (
        <p className="option-panel__about" role="alert">
          {problem}
        </p>
      ) : null}
      <button
        type="button"
        className="button"
        disabled={disabled || selected === null || adding}
        onClick={() => {
          if (selected) void add(selected);
        }}
      >
        {adding ? 'Adding…' : 'Add to the message'}
      </button>
    </div>
  );
}
