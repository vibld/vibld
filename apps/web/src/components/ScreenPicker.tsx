import { useEffect, useId, useState } from 'react';

type ScreenModule = typeof import('@vibld/ai/screen-patterns');

/** "empty-state" as a reader says it: "Empty state". */
function typeLabel(type: string): string {
  const words = type.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The screen patterns (docs/decisions.md, D110): app screens such as a
 * dashboard, settings or an empty state, each with its patterns, states and
 * guardrails. Chosen screens are added to the message as text, so what a
 * build is asked for stays in view and can be edited.
 *
 * The screens load when the panel first opens, not with the builder: they
 * are a few hundred kilobytes nobody needs until they look.
 */
export function ScreenPicker({
  active,
  disabled,
  room,
  onAdd,
}: {
  /** The panel is open. */
  active: boolean;
  disabled: boolean;
  /** How many characters the message has left. */
  room: number;
  onAdd: (text: string) => void;
}) {
  const [screens, setScreens] = useState<ScreenModule | null>(null);
  const [failed, setFailed] = useState(false);
  const [type, setType] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const typeId = useId();

  useEffect(() => {
    if (!active || screens) return;
    let live = true;
    import('@vibld/ai/screen-patterns').then(
      (module) => {
        if (live) setScreens(module);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [active, screens]);

  if (failed) {
    return (
      <p className="option-panel__about" role="alert">
        The screens could not be loaded. Reload the page to try again.
      </p>
    );
  }
  if (!screens) {
    return <p className="option-panel__about">Loading screens…</p>;
  }

  const { SCREENS, MAX_COMPOSED_SCREENS, composedScreens, screenSections } =
    screens;
  const types = [...new Set(SCREENS.map((s) => s.category))].sort();
  const shown = type ? SCREENS.filter((s) => s.category === type) : SCREENS;
  const full = chosen.length >= MAX_COMPOSED_SCREENS;
  // Leave room for the blank line between the message and the screens.
  const fitting = composedScreens(chosen, room - 2).length;

  return (
    <div className="screen-picker">
      <label className="option-panel__label" htmlFor={typeId}>
        Screen type
      </label>
      <select
        id={typeId}
        className="prompt__input"
        value={type}
        onChange={(event) => setType(event.target.value)}
        disabled={disabled}
      >
        <option value="">Every type</option>
        {types.map((t) => (
          <option key={t} value={t}>
            {typeLabel(t)}
          </option>
        ))}
      </select>
      <ul className="screen-picker__list" aria-label="Screens">
        {shown.map((screen) => {
          const on = chosen.includes(screen.id);
          return (
            <li key={screen.id}>
              <label>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={disabled || (!on && full)}
                  onChange={() =>
                    setChosen(
                      on
                        ? chosen.filter((id) => id !== screen.id)
                        : [...chosen, screen.id],
                    )
                  }
                />{' '}
                <span>
                  <strong>{screen.name}</strong>: {screen.summary}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="option-panel__about" role="status">
        {chosen.length === 0
          ? `Choose up to ${MAX_COMPOSED_SCREENS}.`
          : fitting < chosen.length
            ? `${fitting} of ${chosen.length} fit in what the message has left.`
            : `${chosen.length} chosen.`}
      </p>
      <button
        type="button"
        className="button"
        disabled={disabled || fitting === 0}
        onClick={() => {
          onAdd(screenSections(chosen, room - 2));
          setChosen([]);
        }}
      >
        Add to the message
      </button>
    </div>
  );
}
