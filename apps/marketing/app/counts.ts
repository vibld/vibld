/**
 * How vibld.com states a count (Chris, docs/decisions.md D105): rounded
 * down to a friendly "N+" rather than given exactly, so "207 templates" is
 * "200+ templates". The rule is in CLAUDE.md; this is the one place it is
 * applied, and test/counts.test.ts holds the copy to it.
 *
 * - under 10: exact ("4");
 * - 10 to 99: down to the ten ("24" is "20+");
 * - 100 and over: down to the hundred ("207" is "200+", "1,656" is
 *   "1,600+").
 *
 * Prices, measured costs, durations and plan limits are facts rather than
 * counts of what the product has, and are never passed through this.
 *
 * Imports nothing, so the Worker can use it too.
 */
export function approxCount(n: number): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Not a count: ${n}`);
  }
  if (n < 10) return String(n);
  const step = n < 100 ? 10 : 100;
  return `${(Math.floor(n / step) * step).toLocaleString('en-US')}+`;
}
