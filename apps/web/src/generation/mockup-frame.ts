/**
 * The document a mockup frame actually renders (#189 review).
 *
 * `sandbox=""` is the deny-everything list for *capabilities*: no scripts,
 * no same-origin, no forms, no navigating anything else. It is not a
 * network policy and it does not stop the frame replacing itself. Two more
 * things are needed, and this file is where they live: a content policy the
 * document carries, and the removal of the markup that navigates.
 *
 * ## Five findings, one mistake
 *
 * This file was narrowed five times over one review, and it is worth
 * reading why rather than reading five fixes:
 *
 * 1. `sandbox=""` was called a guarantee that "nothing can happen". True of
 *    capabilities, false of fetches: a remote image or web font is still
 *    requested, which hands the viewer's IP to a host the model chose.
 * 2. A meta CSP was added, and inserted after the first `<head>` found by
 *    string search. A `<head` in a comment put the policy somewhere
 *    harmless, governing nothing.
 * 3. The CSP was said to cover navigation. It does not: `default-src`
 *    governs subresource fetches, and `navigate-to` was dropped from the
 *    spec. A `<meta http-equiv="refresh">` navigates with nobody touching
 *    it.
 * 4. That meta was removed by matching `http-equiv="refresh"`. Defeated by
 *    `http-equiv="ref&#x72;esh"`: attribute values are entity-decoded
 *    before the parser compares them.
 * 5. So the match moved to the attribute *name*, which is not decoded, via
 *    `/<meta\b[^>]*http-equiv[^>]*>/`. Defeated by a quoted `>` placed
 *    before it: `<meta data-x=">" http-equiv="refresh" ...>`. The tokenizer
 *    keeps that `>` inside the attribute value and reads the whole tag;
 *    `[^>]*` stops dead at it and the tag survives untouched.
 *
 * Every one of those is the same mistake: deciding what the markup says
 * instead of what the parser will do with it. A sixth regex would be the
 * sixth guess.
 *
 * ## So the parser decides
 *
 * The document is parsed with `DOMParser`, the dangerous nodes are removed
 * from the tree, and the result is serialised. What counts as an
 * `http-equiv` attribute is now decided by the same implementation that
 * will act on it, so quoting, entity encoding, case, whitespace and
 * whatever else I have not thought of are the tokenizer's answer rather
 * than my prediction of it. Findings 4 and 5 both close here, and they
 * close because the parsing does it, not because the selector below is
 * cleverer than the regexes were. `parseFromString` builds an inert document: it
 * runs no script and fetches nothing.
 *
 * Two smaller things fall out. Placement stops being surgery -- the policy
 * is prepended to a `<head>` the parser guarantees exists, in a document
 * that has one even when the input did not. And the doctype is emitted
 * rather than preserved, so the frame cannot land in quirks mode because
 * the input's doctype was malformed or missing.
 *
 * ## What is left, stated rather than glossed
 *
 * A reader can still be shown a link, and clicking it does nothing. That is
 * the honest end of this, not a sixth claim that nothing can happen.
 *
 *   default-src 'none'   nothing loads unless named below
 *   style-src 'unsafe-inline'  the inline <style> and style= a mockup is made of
 *   img-src data:        an embedded image is self-contained; a remote one is not
 *
 * No `font-src`, because a mockup has no way to carry a font except by URL,
 * and system stacks need no permission.
 */
export const MOCKUP_FRAME_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

/**
 * Everything removed from a mockup before it is framed, as one selector.
 *
 * `meta[http-equiv]` rather than `meta[http-equiv="refresh"]`, and the
 * reason is narrower than it was before parsing. A value selector now sees
 * the *decoded* value, so `ref&#x72;esh` and the quoted-`>` tag would both
 * be caught by one -- those bypasses are closed by parsing, not by matching
 * the name, and saying otherwise would be exactly the sort of claim this
 * file keeps having to retract.
 *
 * What the name still buys: CSS value matching is case-sensitive, so
 * `http-equiv="REFRESH"` slips a value selector; and matching the name at
 * all means no judgement is made about which values are dangerous. A sketch
 * has no legitimate use for any `http-equiv`, so there is nothing to weigh
 * against removing the lot. Ours is added afterwards, which is what lets
 * this be that blunt.
 *
 * `base` because ours sets `target` and no `href`. The first `<base>` with
 * an href in tree order becomes the document base, so a mockup's own could
 * still decide what relative URLs resolve against even though ours wins on
 * target. Nothing can be fetched or navigated through it, so this is depth
 * rather than a hole -- and a one-document sketch has no use for a base.
 *
 * The nested browsing contexts are the sixth finding, and the first that
 * parsing alone did not close (#189 review). A query over this document
 * never visits `<iframe srcdoc="...">`, because that markup is an
 * *attribute value* until the browser makes a document of it. The nested
 * document inherits the CSP, which does not govern navigation, and the
 * sandbox lets a nested context replace itself -- so a refresh hidden in
 * there runs with nobody touching it, exactly as the outer one did.
 *
 * Removed rather than recursively sanitised. Recursion means a depth limit
 * and the same question again for `src`, `data:` and whatever else, which
 * is the guessing this file just stopped doing. And it costs a mockup
 * nothing: `default-src 'none'` already denies every one of these a
 * document to load, so the only embed that could ever have worked is a
 * `srcdoc` one, which is a second page rather than content. A sketch is one
 * page.
 *
 * `template` for the same reason rather than for a known path: its content
 * is invisible to this query too, and survives serialisation intact. It
 * cannot activate without script and script is denied, so this is closing a
 * place the query cannot see rather than a hole anyone has shown me. Given
 * how this file's five previous guarantees went, that is the trade I want.
 */
const REMOVE_ENTIRELY =
  'meta[http-equiv], base, iframe, frame, object, embed, template';

/**
 * An explicit target defeats the base below, so it does not get to stay.
 *
 * `target="_self"` on an external link is the click-driven half of the
 * problem: the frame replaces itself and the host learns the viewer's
 * address. Dropping the attribute puts the link back under our base, which
 * aims it at a context the sandbox will not create.
 */
const TARGETED = '[target]';

/**
 * Rewrite a mockup into the document its frame should render.
 *
 * Parse, remove, prepend, serialise. The order matters in one place: our
 * own policy is an `http-equiv` meta, so it is added *after* the removal
 * pass rather than before it.
 */
export function mockupFrameDocument(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  for (const node of Array.from(doc.querySelectorAll(REMOVE_ENTIRELY))) {
    node.remove();
  }
  for (const node of Array.from(doc.querySelectorAll(TARGETED))) {
    node.removeAttribute('target');
  }

  const policy = doc.createElement('meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute('content', MOCKUP_FRAME_POLICY);

  // Without `allow-popups` on the frame, a click aimed at a new context
  // does nothing at all. Making that every link's default turns an external
  // link in a sketch into the inert thing it should be.
  const base = doc.createElement('base');
  base.setAttribute('target', '_blank');

  // A meta CSP governs what the parser meets after it, so first in the head
  // is the whole job. Prepending in this order leaves the policy ahead of
  // the base too, which costs nothing and keeps the rule simple: the policy
  // is the first thing in the document that is not the doctype.
  doc.head.prepend(base);
  doc.head.prepend(policy);

  // Emitted rather than carried over. A doctype that is not first stops
  // being one, and a document with none renders in quirks mode -- and this
  // is a document we built, so neither has to be true of the input.
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
