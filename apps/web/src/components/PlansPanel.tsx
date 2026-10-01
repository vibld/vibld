import { useEffect, useId, useState } from 'react';
import {
  TIER_NAMES,
  formatDay,
  formatUsd,
} from '../admin/admin-users-client.ts';
import {
  describeProjectLimit,
  fetchPlans,
  parsePlanFields,
  resetPlan,
  savePlan,
} from '../admin/plans-client.ts';
import type { PlanView } from '../admin/plans-client.ts';

/**
 * What each plan allows (docs/decisions.md D134): active projects at once
 * and the monthly allowance, set here in place of the code's, and put
 * back with Reset. An account's own override still comes first.
 *
 * vibld.com/pricing is built from the limits in code, not from here, so
 * a change here does not reach it (D134).
 */
export function PlansPanel() {
  const [plans, setPlans] = useState<PlanView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchPlans().then((result) => {
      if (!live) return;
      if (result.ok) setPlans(result.value.plans);
      else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, []);

  async function change(
    run: () => ReturnType<typeof savePlan>,
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
      setPlans(result.value.plans);
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
    <div className="knowledge" role="group" aria-label="Plans">
      <p className="knowledge__summary">Plans</p>
      <p className="pane-note">
        What each plan allows. A change here applies to every account on the
        plan within a minute; an account&rsquo;s own override still comes first.
        vibld.com/pricing is built from the limits in code
        (worker/entitlement.ts), so it does not change with this.
      </p>
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
      {plans === null && error === null ? (
        <p className="pane-note" role="status">
          Loading the plans.
        </p>
      ) : null}
      {plans?.map((plan) => (
        <PlanRow
          // Keyed by what the server answered too, so a save or a reset
          // starts the fields again from the limits now in force, not from
          // what was typed before (a Save after Reset would otherwise put
          // the old limits straight back).
          key={`${plan.tier}:${plan.limits.activeProjectLimit}:${plan.limits.monthlyAllowanceMicroUsd}:${plan.saved?.updatedAt ?? 'code'}`}
          plan={plan}
          busy={busy}
          onSave={(limit, cents) =>
            change(
              () => savePlan(plan.tier, limit, cents),
              `Saved the ${TIER_NAMES[plan.tier]} plan's limits.`,
            )
          }
          onReset={() =>
            change(
              () => resetPlan(plan.tier),
              `${TIER_NAMES[plan.tier]} is back to the limits in code.`,
            )
          }
        />
      ))}
    </div>
  );
}

function PlanRow({
  plan,
  busy,
  onSave,
  onReset,
}: {
  plan: PlanView;
  busy: boolean;
  onSave: (limit: number | null, cents: number) => Promise<boolean>;
  onReset: () => Promise<boolean>;
}) {
  const limitId = useId();
  const allowanceId = useId();
  const [limit, setLimit] = useState(
    plan.limits.activeProjectLimit === null
      ? ''
      : String(plan.limits.activeProjectLimit),
  );
  const [dollars, setDollars] = useState(
    (plan.limits.monthlyAllowanceMicroUsd / 1_000_000).toFixed(2),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const name = TIER_NAMES[plan.tier];

  return (
    <div role="group" aria-label={name}>
      <p className="prompt__label">{name}</p>
      <p className="pane-note">
        Now: {describeProjectLimit(plan.limits.activeProjectLimit)},{' '}
        {formatUsd(plan.limits.monthlyAllowanceMicroUsd)} a month.{' '}
        {plan.saved
          ? `Set ${formatDay(plan.saved.updatedAt)} by ${plan.saved.updatedBy}; in code: ${describeProjectLimit(
              plan.code.activeProjectLimit,
            ).toLowerCase()}, ${formatUsd(plan.code.monthlyAllowanceMicroUsd)}.`
          : 'The limits in code.'}
      </p>
      <form
        className="prompt__row"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = parsePlanFields(limit, dollars);
          if (!parsed.ok) {
            setProblem(parsed.error);
            return;
          }
          setProblem(null);
          void onSave(
            parsed.activeProjectLimit,
            parsed.monthlyAllowanceUsdCents,
          );
        }}
      >
        <label className="prompt__label" htmlFor={limitId}>
          Active projects (blank for no limit)
        </label>
        <input
          id={limitId}
          type="text"
          inputMode="numeric"
          className="prompt__input"
          value={limit}
          disabled={busy}
          onChange={(event) => setLimit(event.target.value)}
        />
        <label className="prompt__label" htmlFor={allowanceId}>
          Monthly allowance ($)
        </label>
        <input
          id={allowanceId}
          type="text"
          inputMode="decimal"
          className="prompt__input"
          value={dollars}
          disabled={busy}
          onChange={(event) => setDollars(event.target.value)}
        />
        <button type="submit" className="button" disabled={busy}>
          Save
        </button>
        {plan.saved ? (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void onReset()}
          >
            Reset to code
          </button>
        ) : null}
      </form>
      {problem ? (
        <p className="pane-note pane-note--error" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
