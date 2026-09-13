/**
 * When a client-side navigation should be counted, and what it came from.
 *
 * Separated from the component so the rule can be tested. The rule is small
 * and every part of it is load-bearing: counting the first view again would
 * double the home page, counting a repeat would double whatever the visitor
 * clicked twice, and not counting a change at all is the bug this exists to
 * fix -- nine legal pages reachable only by an internal link, recording
 * nothing.
 */

export type BeaconDecision = { send: false } | { send: true; referrer: string };

/**
 * @param sent The view already counted, or null before anything has been.
 * @param here The current path and query.
 * @param origin This site's origin, for turning `sent` back into a URL.
 *
 * The caller records `here` as sent in every case, including the ones that
 * send nothing: a view that was skipped because the inline script covered it
 * has still been counted.
 */
export function beaconFor(
  sent: string | null,
  here: string,
  origin: string,
): BeaconDecision {
  // The first view after hydration is the one the inline script in root.tsx
  // already sent.
  if (sent === null) return { send: false };
  // React may run an effect more than once for the same view.
  if (sent === here) return { send: false };
  return { send: true, referrer: new URL(sent, origin).href };
}
