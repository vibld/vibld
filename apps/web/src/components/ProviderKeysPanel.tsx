import { useEffect, useId, useState } from 'react';
import { formatDay } from '../admin/admin-users-client.ts';
import {
  describeKey,
  fetchKeys,
  removeKey,
  saveKey,
} from '../admin/keys-client.ts';
import type { KeyList, ProviderKey } from '../admin/keys-client.ts';

/**
 * The model provider keys this deployment builds with (docs/decisions.md
 * D127, D131): set, replaced and removed here, shown only by their last
 * four characters. A key set here is used instead of the Worker secret of
 * the same name; removing it goes back to that secret.
 *
 * A typed key is held in this component only until it is sent, and the
 * field is cleared whatever the answer.
 */
export function ProviderKeysPanel() {
  const [list, setList] = useState<KeyList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchKeys().then((result) => {
      if (!live) return;
      if (result.ok) setList(result.value);
      else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, []);

  async function change(
    run: () => ReturnType<typeof saveKey>,
    done: string,
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await run();
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      setList((current) => ({
        canStore: current?.canStore ?? true,
        keys: result.value.keys,
      }));
      setNote(
        result.value.audited
          ? done
          : `${done} The audit log did not record it.`,
      );
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="knowledge" role="group" aria-label="Provider keys">
      <p className="knowledge__summary">Provider keys</p>
      <p className="pane-note">
        The keys this deployment builds with. A key set here is used instead of
        the Worker secret of the same provider, and only its last four
        characters are ever shown again.
      </p>
      {list && !list.canStore ? (
        <p className="pane-note pane-note--error">
          Keys cannot be stored here: this deployment has no
          VIBLD_KEY_ENCRYPTION_KEY. The deploy workflow creates it; on a copy
          deployed another way, set it as a Worker secret (32 random bytes,
          base64).
        </p>
      ) : null}
      {error ? (
        <p className="pane-note pane-note--error" role="alert">
          {error}
        </p>
      ) : null}
      {note ? (
        <p className="pane-note" role="status">
          {note}
        </p>
      ) : null}
      {list === null && error === null ? (
        <p className="pane-note" role="status">
          Loading the keys.
        </p>
      ) : null}
      {list?.keys.map((key) => (
        <KeyRow
          key={key.provider}
          entry={key}
          canStore={list.canStore}
          busy={busy}
          onSave={(typed) =>
            change(
              () => saveKey(key.provider, typed),
              `Saved the ${key.name} key.`,
            )
          }
          onRemove={() =>
            change(
              () => removeKey(key.provider),
              key.secretSet
                ? `Removed the ${key.name} key; the Worker secret is used again.`
                : `Removed the ${key.name} key.`,
            )
          }
        />
      ))}
    </div>
  );
}

function KeyRow({
  entry,
  canStore,
  busy,
  onSave,
  onRemove,
}: {
  entry: ProviderKey;
  canStore: boolean;
  busy: boolean;
  onSave: (typed: string) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const fieldId = useId();
  const [typed, setTyped] = useState('');
  const [confirming, setConfirming] = useState(false);

  return (
    <div role="group" aria-label={entry.name}>
      <label className="prompt__label" htmlFor={fieldId}>
        {entry.name}
      </label>
      <p className="pane-note">
        {describeKey(entry)}
        {entry.stored && entry.updatedAt
          ? ` Set ${formatDay(entry.updatedAt)} by ${entry.updatedBy ?? 'unknown'}.`
          : ''}
      </p>
      <form
        className="prompt__row"
        onSubmit={(event) => {
          event.preventDefault();
          const value = typed;
          setTyped('');
          void onSave(value);
        }}
      >
        <input
          id={fieldId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="prompt__input"
          placeholder={entry.source ? 'Replace with a new key' : 'Paste a key'}
          value={typed}
          disabled={busy || !canStore}
          onChange={(event) => setTyped(event.target.value)}
        />
        <button
          type="submit"
          className="button"
          disabled={busy || !canStore || typed.trim() === ''}
        >
          Save
        </button>
      </form>
      {entry.stored ? (
        <div className="prompt__actions">
          {confirming ? (
            <>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  void onRemove();
                }}
              >
                Remove the {entry.name} key
              </button>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Keep it
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              Remove
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
