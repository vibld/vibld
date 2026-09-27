import { secured } from '@vibld/security-headers';

/**
 * What this host tells a crawler, and why it is a header rather than a tag.
 *
 * The first version of this shipped `Disallow: /` in robots.txt beside a
 * `noindex` meta in the shell, and a comment claiming the two failed
 * independently. They do not, and the claim was backwards (#192 review): a
 * crawler that obeys `Disallow` never fetches the page, so it never reads
 * the `noindex`, and a URL discovered from a shared link or a backlink can
 * still be listed with no description. The rule intended to keep the
 * builder out of an index was preventing the rule that would have done it
 * from being seen.
 *
 * So crawling is allowed and the directive is sent with the response. As a
 * header rather than only a tag, for two reasons: it does not depend on the
 * crawler parsing HTML, and it covers the responses that are not HTML at
 * all. The meta in `index.html` stays as a second copy for anything that
 * reads the document directly.
 *
 * Not in `SECURITY_HEADERS`, because that object is shared with the
 * marketing site and everything in it is decided by facts both sites share.
 * This one is not: vibld.com wants to be found.
 */
export const APP_ONLY_HEADERS: Readonly<Record<string, string>> = {
  'x-robots-tag': 'noindex, nofollow',
};

/**
 * `secured`, plus the headers only this host sends.
 *
 * A function rather than two statements in `fetch`, because `fetch` having
 * exactly one is the rule that stops a later route returning without any of
 * this, and `security-headers.test.ts` asserts it. Adding the second half
 * inline would have bought a header by spending the guarantee.
 */
export function securedApp(response: Response): Response {
  const wrapped = secured(response);
  for (const [name, value] of Object.entries(APP_ONLY_HEADERS)) {
    wrapped.headers.set(name, value);
  }
  return wrapped;
}
