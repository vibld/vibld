/**
 * The document a mockup frame actually renders (#189 review, P1).
 *
 * `sandbox=""` is the deny-everything list for *capabilities*: no scripts,
 * no same-origin, no forms, no navigation. It is not a network policy. An
 * `<img src="https://...">`, a `<link rel=stylesheet>`, a web font or a CSS
 * `url()` is still fetched from inside a fully sandboxed frame, which
 * discloses the viewer's IP address to a host the model chose and confirms
 * to that host that the page was rendered.
 *
 * The mockup prompt forbids all of those. That is a request, and the whole
 * argument for the sandbox was that a request is not a guarantee -- so
 * leaving the network on the prompt's good behaviour was the same mistake
 * one layer down. I had written that these frames "cannot do anything",
 * which was not true of the network.
 *
 * A meta CSP is the enforcement that fits: the frame has no origin of its
 * own and no response headers to set, and this travels inside the document
 * it governs.
 *
 * It is not the whole job, and this file's guarantee has now been narrowed
 * four times over one review (#189). A CSP governs what a document
 * *fetches*; it does not govern where the document *goes*. A `<meta
 * http-equiv="refresh">` navigates the frame with nobody touching it, and
 * the directive that used to cover that was dropped from the spec. So
 * self-navigation is removed from the markup as well, and links are made
 * to want a popup the sandbox will not open.
 *
 * The fourth narrowing is the one worth learning from. Removing the
 * refresh by matching `http-equiv="refresh"` was defeated by
 * `http-equiv="ref&#x72;esh"`, because the parser decodes attribute values
 * and a regex over the source does not. Every miss in this file has the
 * same shape: I decided what the markup said instead of what the parser
 * would say. So what is matched below is attribute *names*, which are not
 * decoded, and what is removed is whole categories a sketch has no use for
 * rather than the specific spellings that looked dangerous.
 *
 * What is left, stated rather than glossed: a reader can still be shown a
 * link, and clicking it does nothing. That is the honest end of this.
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
 * Links open in a new context the sandbox then refuses to create.
 *
 * `sandbox=""` blocks a frame navigating anything but itself, and a CSP
 * cannot stop self-navigation: `default-src` governs subresource fetches,
 * and the directive that governed navigation (`navigate-to`) was dropped
 * from the spec and never shipped. So the lever is the markup.
 *
 * Without `allow-popups`, a click targeted at a new context does nothing
 * at all. Making that the default turns every ordinary link in a mockup
 * into the inert thing a sketch's links should be.
 */
const BASE = '<base target="_blank">';

const META = `<meta http-equiv="Content-Security-Policy" content="${MOCKUP_FRAME_POLICY}">${BASE}`;

/**
 * Any `<meta>` that carries an `http-equiv`, whatever it claims to say.
 *
 * The first version of this matched the *value*, `http-equiv="refresh"`,
 * and a reviewer broke it in one line: `http-equiv="ref&#x72;esh"`. The
 * HTML parser decodes character references in attribute values, so it sees
 * `refresh` and navigates; a regex reading the raw source sees a string
 * that is not `refresh` and leaves the tag alone. Chasing that with a
 * decoder means writing an entity table, and then being wrong about
 * whatever the table missed.
 *
 * Attribute *names* are not entity-decoded -- the tokenizer reads them
 * literally -- so the name is the part that can be matched with certainty.
 * Matching it is also a stronger rule than the one it replaces: a sketch
 * has no legitimate use for any `http-equiv` at all, so there is nothing
 * to weigh against removing every one of them.
 *
 * This is the fourth narrowing of this file (sandbox, then fetches, then
 * navigation, now the spelling of it). Every one so far was a case where I
 * decided what the document said instead of what the parser would say.
 */
const HTTP_EQUIV_META = /<meta\b[^>]*\bhttp-equiv\b[^>]*>/gi;

/**
 * The document's own `<base>`, for the same reason.
 *
 * Ours leads the markup, and the first `<base target>` in tree order wins,
 * so a mockup's own `target` could not override it. Its `href` is another
 * matter: ours sets no href, so a later `<base href="https://evil/">` is
 * the first with one and becomes the document base that every relative URL
 * resolves against. Nothing can be fetched through it (`default-src
 * 'none'`) and nothing can be navigated to (the sandbox denies the popup),
 * so this is defence in depth rather than a hole being closed. It costs a
 * sketch nothing: a one-document page has no use for a base.
 */
const DOCUMENT_BASE = /<base\b[^>]*>/gi;

/**
 * An explicit target defeats the base above, so it does not get to stay.
 *
 * `target="_self"` on an external link is the click-driven half of the same
 * problem: the frame replaces itself and the host learns the viewer's
 * address. Stripping the attribute puts the link back under the base.
 *
 * Matched on the name too, and for the same reason as `HTTP_EQUIV_META`:
 * the value is decoded before the parser reads it, the name is not.
 */
const EXPLICIT_TARGET = /\starget\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

/** Everything a mockup may not do to its own browsing context. */
export function withoutSelfNavigation(html: string): string {
  return html
    .replace(HTTP_EQUIV_META, '')
    .replace(DOCUMENT_BASE, '')
    .replace(EXPLICIT_TARGET, '');
}

/**
 * Put the policy in front of everything the document might fetch.
 *
 * A meta CSP governs only what the parser meets after it, so placement is
 * the whole job -- being second is the same as being absent.
 *
 * Placed by the doctype rather than by finding `<head>`, which is what
 * this did first. Searching for the head means trusting the document to be
 * well formed: a `<head` inside a comment, or a stray one in text, and the
 * policy lands somewhere harmless and governs nothing. That is a bypass of
 * the protection, in a function whose entire reason for existing is that
 * the document cannot be trusted.
 *
 * A `<meta>` before `<html>` is not misplaced, it is hoisted: the parser
 * meets it in "before head", creates the head, and makes the meta its
 * first child. So leading the markup puts the policy first in the head of
 * every document, including one that has no head of its own and one whose
 * head is not where it claims. After the doctype, because a doctype that
 * is no longer first stops being one and the frame drops into quirks mode.
 */
export function mockupFrameDocument(html: string): string {
  const safe = withoutSelfNavigation(html);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(safe);
  if (doctype) {
    const at = doctype[0].length;
    return `${safe.slice(0, at)}${META}${safe.slice(at)}`;
  }
  return `${META}${safe}`;
}
