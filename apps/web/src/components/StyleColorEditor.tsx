import { useEffect, useState } from 'react';

import { checkColorEdits, isDecorativeRole } from '@vibld/ai/style-gallery';
import type {
  StyleColorEdits,
  StyleColorSubject,
} from '@vibld/ai/style-gallery';

import { loadStyleColors } from '../generation/style-gallery-client.ts';

/**
 * The theme guard (docs/decisions.md, D147): the chosen gallery style's
 * colors, each editable, and every edit checked against all of the style's
 * measured contrast pairs before it is kept. An edit that fails one is not
 * applied, and the editor says which pairs it broke. The Worker checks the
 * kept edits again before a build uses them.
 */
export function StyleColorEditor({
  styleId,
  value,
  onChange,
  disabled,
  loader = loadStyleColors,
}: {
  styleId: string;
  /** The kept edits by token, or null for none. */
  value: StyleColorEdits | null;
  onChange: (edits: StyleColorEdits | null) => void;
  disabled: boolean;
  /** For tests. */
  loader?: typeof loadStyleColors;
}) {
  const [subject, setSubject] = useState<StyleColorSubject | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [refused, setRefused] = useState<string[] | null>(null);

  useEffect(() => {
    let live = true;
    setSubject(null);
    setFailure(null);
    setRefused(null);
    void loader(styleId).then((result) => {
      if (!live) return;
      if (result.ok) setSubject(result.subject);
      else setFailure(result.message);
    });
    return () => {
      live = false;
    };
  }, [styleId, loader]);

  if (failure) {
    return <p className="option-panel__about">{failure}</p>;
  }
  if (!subject) return null;

  const edits = value ?? {};
  const edit = (token: string, hex: string, original: string) => {
    const next: Record<string, string> = { ...edits };
    if (hex === original) delete next[token];
    else next[token] = hex;
    const check = checkColorEdits(subject, next);
    if (!check.ok) {
      setRefused(check.problems);
      return;
    }
    setRefused(null);
    onChange(Object.keys(next).length > 0 ? next : null);
  };

  return (
    <fieldset className="gallery__colors" disabled={disabled}>
      <legend className="option-panel__label">Colors</legend>
      <ul>
        {subject.design_tokens.colors.map((color) => {
          const name = color.token.replace(/^--color-/, '');
          const current = edits[color.token] ?? color.hex;
          return (
            <li key={color.token}>
              <label>
                <input
                  type="color"
                  value={current}
                  onChange={(event) =>
                    edit(
                      color.token,
                      event.target.value.toLowerCase(),
                      color.hex,
                    )
                  }
                />
                <span className="gallery__color-name">{name}</span>
                <span className="gallery__color-role">
                  {isDecorativeRole(color.role)
                    ? `${color.role}, never behind text`
                    : color.role}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {refused ? (
        <div role="alert" className="option-panel__about">
          <p>That color was not applied. It fails these contrast checks:</p>
          <ul>
            {refused.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {value ? (
        <button
          type="button"
          className="linkbutton"
          onClick={() => {
            setRefused(null);
            onChange(null);
          }}
        >
          Reset colors
        </button>
      ) : null}
    </fieldset>
  );
}
