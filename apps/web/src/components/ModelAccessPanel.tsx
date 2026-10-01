import { useEffect, useState } from 'react';
import { TIER_NAMES, formatDay } from '../admin/admin-users-client.ts';
import type { Tier } from '../admin/admin-users-client.ts';
import {
  fetchModelAccess,
  resetModelAccess,
  saveModelAccess,
  toggled,
} from '../admin/models-client.ts';
import type { ModelAccess, PlanModels } from '../admin/models-client.ts';

const TIERS: readonly Tier[] = ['free', 'build', 'ship'];

/**
 * Which models each plan includes (docs/decisions.md D133, D135): ticked
 * here and saved for all three plans at once. Until the first save,
 * `VIBLD_MODEL_POLICY` and the plan rule in code decide; after it, this
 * does, and "Go back to the policy" undoes that. A deployment that sells
 * no plans uses the Free column. An account's extra models are set on its
 * own page (D136).
 */
export function ModelAccessPanel() {
  const [access, setAccess] = useState<ModelAccess | null>(null);
  const [plans, setPlans] = useState<PlanModels | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchModelAccess().then((result) => {
      if (!live) return;
      if (result.ok) {
        setAccess(result.value);
        setPlans(result.value.plans);
      } else {
        setError(result.error);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  async function change(
    run: () => ReturnType<typeof saveModelAccess>,
    done: string,
  ) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await run();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAccess(result.value);
      setPlans(result.value.plans);
      setNote(
        result.value.audited
          ? done
          : `${done} The audit log did not record it.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="knowledge" role="group" aria-label="Models">
      <p className="knowledge__summary">Models</p>
      <p className="pane-note">
        Which models each plan includes. A change applies to every account on
        the plan within a minute. A deployment that sells no plans uses the Free
        column. Extra models for one account are set on its page.
      </p>
      {access ? (
        <p className="pane-note">
          {access.saved
            ? `Saved ${formatDay(access.saved.updatedAt)} by ${access.saved.updatedBy}. These lists decide; VIBLD_MODEL_POLICY is not used.`
            : `Not saved yet: ${
                access.policySet
                  ? 'VIBLD_MODEL_POLICY decides, with'
                  : 'every model with a key is offered, with'
              } Free held to GPT-6 Luna where plans are sold. The boxes show the starting setting; saving makes these lists decide instead.`}
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
      {access === null && error === null ? (
        <p className="pane-note" role="status">
          Loading the models.
        </p>
      ) : null}
      {access && plans ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void change(
              () => saveModelAccess(plans),
              'Saved which models each plan includes.',
            );
          }}
        >
          <div className="accounts__scroll">
            <table className="accounts__table">
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  {TIERS.map((tier) => (
                    <th scope="col" key={tier}>
                      {TIER_NAMES[tier]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {access.catalog.map((model) => (
                  <tr key={model.id}>
                    <th scope="row">
                      {model.label}
                      {model.deployable ? '' : ' (no key, not offered)'}
                    </th>
                    {TIERS.map((tier) => (
                      <td key={tier}>
                        <input
                          type="checkbox"
                          aria-label={`${model.label} on ${TIER_NAMES[tier]}`}
                          checked={plans[tier].includes(model.id)}
                          disabled={busy}
                          onChange={(event) =>
                            setPlans({
                              ...plans,
                              [tier]: toggled(
                                access.catalog,
                                plans[tier],
                                model.id,
                                event.target.checked,
                              ),
                            })
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="prompt__actions">
            <button type="submit" className="button" disabled={busy}>
              Save model access
            </button>
            {access.saved ? (
              confirming ? (
                <>
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      setConfirming(false);
                      void change(
                        () => resetModelAccess(),
                        'VIBLD_MODEL_POLICY decides again.',
                      );
                    }}
                  >
                    Stop using these lists
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => setConfirming(false)}
                  >
                    Keep them
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => setConfirming(true)}
                >
                  Go back to the policy
                </button>
              )
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
