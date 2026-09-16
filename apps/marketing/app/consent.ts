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
  removeItem(key: string): void;
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

/** Where gtag.js comes from. Shared so the loader and its test cannot drift. */
export const GA4_SRC = 'https://www.googletagmanager.com/gtag/js?id=';

/** The window event the banner fires when an answer is given, so the tag hears it. */
export const CONSENT_CHANGED_EVENT = 'vibld:consent-changed';

/**
 * What that event carries.
 *
 * `allowReload` rides along rather than being worked out by the listener,
 * because only the code that just tried to write the answer knows whether
 * the store now holds something worse than what is on screen. A listener
 * re-deriving it would read the same stale `granted` that makes the reload
 * unsafe in the first place.
 */
export interface ConsentChange {
  state: ConsentState;
  allowReload: boolean;
}

/**
 * The channel an answer travels on between open tabs.
 *
 * `storage` events were the first attempt and they are not enough, because
 * they only fire when something was actually written. The case they miss is
 * the one that matters most: writing and removing both fail, a stale grant
 * survives, nothing in the store changes, and every other tab goes on
 * measuring after the visitor has said no. Nothing had happened for them to
 * hear about.
 *
 * Both are kept. This one carries an answer the store never recorded; the
 * storage listener catches changes this never sees, such as site data cleared
 * from browser settings, or a tab opened before this channel existed.
 */
export const CONSENT_CHANNEL = 'vibld.consent';

/**
 * The payload for other tabs.
 *
 * `allowReload` is carried rather than recomputed for the same reason it is
 * on the local event: a receiving tab would work it out from its own copy of
 * the store, which in the failure case still says granted, and it would
 * reload straight into the grant that was just withdrawn.
 */
export function consentChangeFor(outcome: AnswerOutcome): ConsentChange {
  return { state: outcome.apply, allowReload: outcome.safeToReload };
}

/**
 * Whether Google Analytics may be loaded at all.
 *
 * The first version of this shipped the tag to everyone and used Consent
 * Mode to withhold storage. That is a real mode and it does not match what
 * the Cookie Notice says. Under denied consent gtag.js is still fetched from
 * Google and still sends cookieless pings, so "it runs only if you say yes"
 * would have been false, and a privacy notice that is approximately true is
 * the kind of thing there is no point writing at all.
 *
 * So the rule is the strong one: nothing is requested from Google until the
 * answer is `granted`. Undecided and denied are the same here, deliberately,
 * because a visitor who has not been asked has not agreed.
 */
export function shouldLoadAnalytics(state: ConsentState): boolean {
  return state === 'granted';
}

/**
 * Forget the stored answer.
 *
 * The recovery path for a denial that could not be written. A stale
 * `granted` left behind is worse than no answer at all, and removing a key
 * can succeed where writing one fails: a quota error is the ordinary case,
 * and deleting is what frees the quota.
 */
export function clearConsent(storage: ConsentStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(CONSENT_KEY);
  } catch {
    // Nothing more to try. `recordAnswer` re-reads rather than trusting this.
  }
}

/** What an answer did, once the attempt to remember it has been made. */
export interface AnswerOutcome {
  /** What the tag should now do. */
  apply: ConsentChoice;
  /**
   * Whether the document may be replaced to honour this answer.
   *
   * False only when the next document would read something worse than what
   * is on screen now, which is the one case where reloading makes things
   * worse rather than better.
   */
  safeToReload: boolean;
  /** Whether to tell the visitor their choice will not survive this visit. */
  warn: boolean;
}

/**
 * Record an answer, and say what may now be done about it.
 *
 * This does the writing as well as the deciding, because the two cannot be
 * separated here: what is safe to do next depends on what is actually in the
 * store afterwards, and only a re-read knows that.
 *
 * The case that forced this is the collision of two earlier fixes, and it is
 * the nastiest bug in the whole change. A visitor with `granted` stored
 * clicks "No thanks"; the write throws. The old rule called a lost denial
 * harmless, because a lost denial re-reads as undecided, which denies anyway.
 * That was only ever true with nothing already stored. With a grant still
 * there, the denial was applied to the live tag, the document was replaced to
 * be rid of it, and the new document read `granted` and loaded analytics
 * again. Clicking "No thanks" would have reloaded the page and turned
 * analytics back on, with no warning, because each half was reasonable and
 * nobody had looked at both.
 *
 * So a denial that cannot be written tries to remove the key instead, and
 * then reads the store to find out what the next document would actually
 * see. Only that decides whether reloading is allowed and whether the
 * visitor is told. Nothing here trusts a write or a removal to have worked.
 */
export function recordAnswer(
  storage: ConsentStorage | null,
  choice: ConsentChoice,
): AnswerOutcome {
  if (writeConsent(storage, choice)) {
    return { apply: choice, safeToReload: true, warn: false };
  }

  // A lost "yes" is applied for this document and says so. Reloading is
  // still safe: the next document reads no grant and simply does not load.
  if (choice === 'granted') {
    return { apply: 'granted', safeToReload: true, warn: true };
  }

  clearConsent(storage);
  const next = readConsent(storage);
  const safe = next !== 'granted';
  return { apply: 'denied', safeToReload: safe, warn: !safe };
}

/** What the tag should be made to do, given an answer and what it is doing now. */
export type AnalyticsAction = 'load' | 'grant' | 'deny' | 'nothing';

/**
 * The whole lifecycle of the tag in one rule.
 *
 * `shouldLoadAnalytics` answers only the first question, and answering only
 * that is what produced two real bugs in review. A visitor can say yes, say
 * no, and say yes again without ever reloading the page, and each of those
 * three is a different instruction to gtag:
 *
 * - The first yes loads it, because nothing has been requested from Google.
 * - A no cannot unload a script already in the document. It is an update to
 *   denied, which stops storage at once, and then the document is replaced,
 *   because an update alone leaves the tag running: this is a single-page
 *   app, so internal links never create a new document and Enhanced
 *   Measurement would keep sending cookieless hits to Google for the rest of
 *   the visit. Doing nothing at all left GA4 storing after "No thanks".
 * - A second yes must be an update back to granted. Skipping it because the
 *   tag "is already loaded" left GA4 denied for the rest of the visit while
 *   the stored answer and the closed banner both said otherwise.
 * - A no before anything loaded is the only case with nothing to say, and
 *   saying anything would mean a queue existing for a tag that does not.
 */
export function analyticsAction(
  state: ConsentState,
  running: boolean,
): AnalyticsAction {
  if (shouldLoadAnalytics(state)) return running ? 'grant' : 'load';
  return running ? 'deny' : 'nothing';
}

/**
 * Whether honouring this action needs the document replaced.
 *
 * Only a withdrawal does, and only because the tag is already here. Nothing
 * in the page can remove a running script, and on a site that navigates
 * without reloading, "stopped" otherwise means "still measuring, just
 * without cookies" for as long as the visitor stays.
 *
 * It is deliberately not every action. A first "No thanks" loads nothing, so
 * reloading would be a jolt in exchange for nothing, and it is the far more
 * common click of the two.
 */
export function mustReload(action: AnalyticsAction): boolean {
  return action === 'deny';
}

/**
 * Whether a `storage` event is about the consent answer.
 *
 * A `storage` event fires in every *other* document on this origin, never in
 * the one that wrote, which is exactly the case this exists for: two tabs
 * open, "No thanks" clicked in one, and the other still running the tag it
 * loaded earlier. The stored answer is already shared; nothing was listening
 * for it to change.
 *
 * `key` is null when the whole store was cleared rather than one key written,
 * which clears the answer too. Checking only for an exact key match would
 * miss it, and clearing site data is a fairly direct way of saying no.
 */
export function isConsentStorageEvent(key: string | null): boolean {
  return key === null || key === CONSENT_KEY;
}

/**
 * The global that stops gtag.js sending anything at all.
 *
 * Google's own opt-out switch, named after the property: setting
 * `window['ga-disable-G-XXXXXXX']` to true makes the loaded tag send nothing.
 * It is the piece that was missing from a withdrawal that cannot reload.
 *
 * A consent update denies storage. It does not stop measurement: the tag
 * carries on sending cookieless hits, which is fine for a visitor who only
 * objects to cookies and is not fine for one who clicked "No thanks" and was
 * told analytics was off. Replacing the document usually settles it, but the
 * one case where the document must not be replaced, a denial the store
 * refused to record over a surviving grant, is exactly the case where the
 * tag would otherwise keep running with the banner claiming it had stopped.
 */
export function gaDisableFlag(measurementId: string): string {
  return `ga-disable-${measurementId}`;
}

/**
 * The analytics cookies present, by name.
 *
 * Denying consent stops new cookies. It does not remove the ones already
 * written, and `_ga` is the client identifier itself: leaving it behind means
 * a visitor who says no still carries the id that links them to what they did
 * before, and granting again months later resumes the same identity. The
 * Cookie Notice says nothing is stored when the answer is no, so the ones
 * already there have to go.
 *
 * Matched by prefix rather than by an exact list, because the per-property
 * cookie is `_ga_<container>` and the name of the container is not something
 * this file should have to know. The prefix covers what GA4 writes: `_ga`,
 * `_ga_<container>`, and `_gac_*` if Ads linking is ever turned on. It does
 * not cover `_gid`, which is Universal Analytics and which GA4 does not set;
 * an earlier version of this comment said otherwise and the test below
 * caught it.
 *
 * Nothing else on this origin uses the prefix, and clearing a cookie we did
 * not set would not be harmless: it could be a session or an anti-abuse
 * token.
 */
export function analyticsCookieNames(cookie: string): string[] {
  return cookie
    .split(';')
    .map((pair) => pair.split('=')[0]?.trim() ?? '')
    .filter((name) => name.startsWith('_ga'));
}

/**
 * Every domain a GA cookie might have been set on, for this hostname.
 *
 * A cookie can only be deleted by writing it back with the same domain and
 * path, and the domain it was written with is not readable from script: the
 * cookie header gives names and values and nothing else. So each candidate is
 * tried. `null` means no `Domain` attribute at all, which is a host-only
 * cookie and a different cookie from the same name on `.example.com`.
 *
 * GA writes on the highest registrable domain it can, which for a site served
 * at `www.example.com` is `.example.com`, so the parents matter rather than
 * being defensive padding.
 */
export function cookieDomainsFor(hostname: string): (string | null)[] {
  const parts = hostname.split('.');
  const domains: (string | null)[] = [null];
  for (let index = 0; index < parts.length - 1; index += 1) {
    domains.push(`.${parts.slice(index).join('.')}`);
  }
  return domains;
}

/** One expiry string: the same cookie, empty, already stale. */
export function expiredCookie(name: string, domain: string | null): string {
  const base = `${name}=; Max-Age=0; path=/`;
  return domain === null ? base : `${base}; domain=${domain}`;
}
