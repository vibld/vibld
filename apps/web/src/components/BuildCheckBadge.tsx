import { checkWords } from '../generation/build-check.ts';
import type { BuildCheck } from '../generation/build-check.ts';

/**
 * What is said about the code on screen while it is checked, and after, when
 * it did not pass (docs/decisions.md, D69, "show early, badge it").
 *
 * Small and in one place, above the preview: a label and one sentence. A
 * check that is going is news that changes (`role="status"`); one that
 * found the code does not build is left for the person to read rather than
 * announced over what they are doing, since the conversation says it too.
 */
export function BuildCheckBadge({ check }: { check: BuildCheck | null }) {
  if (!check) return null;
  const { label, detail } = checkWords(check);
  const going = check.state === 'checking' || check.state === 'repairing';
  return (
    <div
      className={`check-badge check-badge--${check.state}`}
      role="status"
      aria-live={going ? 'polite' : 'off'}
    >
      <span className="check-badge__label">
        {going ? (
          <span className="check-badge__working" aria-hidden="true" />
        ) : null}
        {label}
      </span>
      <span className="check-badge__detail">{detail}</span>
    </div>
  );
}
