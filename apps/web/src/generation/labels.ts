/**
 * Wording that has to stay true as the deployment changes.
 *
 * The header used to assert "deterministic fake provider -- no model
 * credentials" unconditionally. That was accurate when it was written and
 * silently became a lie the moment the hosted Worker started generating.
 * Deriving the line from state means it cannot go stale on its own, and
 * putting it here means the claim is testable.
 */

/** How the header describes the way this deployment generates. */
export function describeMode(providerId: string | null): string {
  if (providerId === null) {
    return 'Plans, stages and validates every change as a checkpoint you accept.';
  }
  if (providerId === 'fake') {
    return 'Deterministic fake provider · this deployment has no model credentials';
  }
  return `Model generation · ${providerId}`;
}
