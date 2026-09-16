/**
 * Whether the visitor has agreed to Google Analytics, and how that answer is
 * stored, read and turned into gtag's consent signals.
 *
 * Separated from the component for the same reason `pageview.ts` is: this is
 * the part with rules in it, and a rule that cannot be tested is a rule
 * nobody checks. The component below it only renders what this decides.
 *
 * Our own first-party counter (`worker/analytics.ts`) is deliberately not
 * covered by any of this. It sets no cookie, assigns no identifier and stores
 * no IP address, so there is nothing to consent to and no reason to make a
 * visitor click before a page works.
 */

/** One key, in one place, because the head script and the component share it. */
export const CONSENT_KEY = 'vibld.consent.analytics';

/**
 * `null` is not a third state the visitor can choose. It means they have not
 * been asked yet, or the answer could not be read, and it is the case the
 * banner exists for.
 */
export type ConsentChoice = 'granted' | 'denied';
export type ConsentState = ConsentChoice | null;

/**
 * The smallest surface `readConsent` and `writeConsent` need.
 *
 * `localStorage` is a `Storage`, but a Storage is not always reachable: in a
 * private window, with site data blocked, or inside a sandboxed frame, the
 * property access itself throws rather than returning undefined. Taking it as
 * an argument is what lets the tests cover that without a browser.
 */
export interface ConsentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * What was stored, or null.
 *
 * Every failure resolves to null, which denies. A value we cannot read is not
 * permission: an unreadable store, a key someone else wrote, or a string that
 * is neither answer all mean the visitor has not agreed, and the banner asks
 * again. Erring the other way would set cookies on the strength of a typo.
 */
export function readConsent(storage: ConsentStorage | null): ConsentState {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
  if (raw === 'granted' || raw === 'denied') return raw;
  return null;
}

/**
 * Records the answer, and reports whether it was actually recorded.
 *
 * A write that silently failed would show the banner again on the next page,
 * which reads as the site ignoring the visitor. The caller cannot fix the
 * store, but it can stop pretending, so the result is returned rather than
 * discarded.
 */
export function writeConsent(
  storage: ConsentStorage | null,
  choice: ConsentChoice,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CONSENT_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

/**
 * The gtag consent signals for a state.
 *
 * Only `analytics_storage` is ours to move. The advertising signals are named
 * explicitly and left denied rather than omitted: an unset signal is not a
 * denied one, and this site runs no advertising scripts, so there is no state
 * in which granting them would be right.
 */
export function consentSignals(state: ConsentState): Record<string, string> {
  return {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: state === 'granted' ? 'granted' : 'denied',
  };
}

/** The window event the footer's "Cookie preferences" link fires to reopen the banner. */
export const CONSENT_OPEN_EVENT = 'vibld:consent-open';

/**
 * Whether the banner should be showing.
 *
 * Two ways in, and they are not the same: an undecided visitor is asked
 * without having done anything, and a decided one is asked only because they
 * clicked the footer link. Reopening has to work after either answer, which
 * is why this cannot simply be "no choice stored".
 */
export function bannerVisible(state: ConsentState, reopened: boolean): boolean {
  return reopened || state === null;
}
