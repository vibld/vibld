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
 *   default-src 'none'   nothing loads unless named below
 *   style-src 'unsafe-inline'  the inline <style> and style= a mockup is made of
 *   img-src data:        an embedded image is self-contained; a remote one is not
 *
 * No `font-src`, because a mockup has no way to carry a font except by URL,
 * and system stacks need no permission.
 */
export const MOCKUP_FRAME_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

const META = `<meta http-equiv="Content-Security-Policy" content="${MOCKUP_FRAME_POLICY}">`;

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
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  if (doctype) {
    const at = doctype[0].length;
    return `${html.slice(0, at)}${META}${html.slice(at)}`;
  }
  return `${META}${html}`;
}
