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
 * It is not the whole job, which is the third time this file's guarantee
 * has had to be narrowed (#189 review). A CSP governs what a document
 * *fetches*; it does not govern where the document *goes*. A `<meta
 * http-equiv="refresh">` navigates the frame with nobody touching it, and
 * the directive that used to cover that was dropped from the spec. So
 * self-navigation is removed from the markup as well, and links are made
 * to want a popup the sandbox will not open.
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
 * Markup that navigates the frame on its own, with nobody touching it.
 *
 * A meta refresh is the one that matters: it needs no click, so a mockup
 * carrying one contacts a host the model chose the instant it renders. The
 * policy above does not stop it, and neither does the sandbox.
 *
 * Removed rather than rewritten. A refresh in a sketch has no legitimate
 * job, so there is nothing to preserve, and a transform that tried to keep
 * it while making it safe would be a parser this file is not.
 */
const SELF_NAVIGATION =
  /<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi;

/**
 * An explicit target defeats the base above, so it does not get to stay.
 *
 * `target="_self"` on an external link is the click-driven half of the same
 * problem: the frame replaces itself and the host learns the viewer's
 * address. Stripping the attribute puts the link back under the base.
 */
const EXPLICIT_TARGET = /\starget\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;

/** Everything a mockup may not do to its own browsing context. */
export function withoutSelfNavigation(html: string): string {
  return html.replace(SELF_NAVIGATION, '').replace(EXPLICIT_TARGET, '');
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
