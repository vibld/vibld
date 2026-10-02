import { useEffect, useId, useRef, useState } from 'react';

import type { DesignTemplateName } from '@vibld/ai/design-template-index';

import { loadTemplateBrief } from '../templates/template-brief-client.ts';

type IndexModule = typeof import('@vibld/ai/design-template-index');

/** The use cases as vibld.com names them (apps/marketing/app/use-cases.ts). */
const USE_CASE_LABELS: Record<DesignTemplateName['useCase'], string> = {
  'small-business': 'Small business site',
  portfolio: 'Portfolio',
  'saas-landing': 'SaaS landing page',
  events: 'Events and bookings',
  tools: 'Small tools and apps',
};

/**
 * A design template as inspiration (docs/decisions.md, D148): the template
 * catalog vibld.com shows, searchable here, and the chosen template's brief
 * added to the message as text, as "Start from this template" on vibld.com
 * fills it (D106). What a build is asked for stays in view and can be
 * edited.
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
}) {
  const [index, setIndex] = useState<IndexModule | null>(null);
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState('');
  const [useCase, setUseCase] = useState('');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const kindId = useId();
  const useCaseId = useId();
  const searchId = useId();
  // The message as it is now, read when a brief arrives: one sent or edited
  // while the brief loaded is not the message it was asked for.
  const latest = useRef(message);
  latest.current = message;

  useEffect(() => {
    if (!active || index) return;
    let live = true;
    import('@vibld/ai/design-template-index').then(
      (module) => {
        if (live) setIndex(module);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [active, index]);

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
  const shown = index.DESIGN_TEMPLATE_INDEX.filter(
    (template) =>
      !template.mergedInto &&
      (!kind || template.kind === kind) &&
      (!useCase || template.useCase === useCase) &&
      words.every((word) =>
        `${template.name} ${template.summary}`.toLowerCase().includes(word),
      ),
  );

  // A choice the filters hide is no choice: what is added is what is seen.
  const selected =
    chosen !== null && shown.some((template) => template.id === chosen)
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
          <label className="option-panel__label" htmlFor={kindId}>
            Kind
          </label>
          <select
            id={kindId}
            className="prompt__input"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            disabled={disabled}
          >
            <option value="">Sites and apps</option>
            <option value="site">Sites</option>
            <option value="app">Apps</option>
          </select>
        </div>
        <div>
          <label className="option-panel__label" htmlFor={useCaseId}>
            Use case
          </label>
          <select
            id={useCaseId}
            className="prompt__input"
            value={useCase}
            onChange={(event) => setUseCase(event.target.value)}
            disabled={disabled}
          >
            <option value="">Every use case</option>
            {Object.entries(USE_CASE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
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
            onChange={(event) => setQuery(event.target.value)}
            disabled={disabled}
          />
        </div>
      </div>
      <ul className="gallery__grid" aria-label="Templates">
        {shown.map((template) => {
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
