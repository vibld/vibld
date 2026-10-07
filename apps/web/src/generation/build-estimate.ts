import type { BuildEstimate } from './remote-provider.ts';

/**
 * What the composer says a build is expected to cost, beside the send
 * button (Chris, 2026-10-05). Rounded up to the cent, never to the nearest:
 * the figure is there so nobody is charged more than they were told, and
 * rounding $0.124 down to $0.12 would be the first way to break that.
 *
 * A project's first build also draws a draft while it runs, from the same
 * credit, so its figure includes the most that draft can cost.
 *
 * Null where there is nothing worth saying: no estimate, or a model that
 * costs nothing to run (D124).
 */
export function buildEstimateText(
  estimate: BuildEstimate | null | undefined,
  firstBuild: boolean,
): { text: string; title: string } | null {
  if (!estimate || estimate.microUsd <= 0) return null;
  const micro = estimate.microUsd + (firstBuild ? estimate.draftMicroUsd : 0);
  const amount = `$${(Math.ceil(micro / 10_000) / 100).toFixed(2)}`;
  return estimate.basis === 'history'
    ? {
        text: `About ${amount} a build`,
        title:
          'Nine in ten recent builds on this model cost less than this. A build is charged what it actually uses.',
      }
    : {
        text: `Up to ${amount} a build`,
        title:
          'The most a build on this model can cost. A build is charged what it actually uses.',
      };
}
