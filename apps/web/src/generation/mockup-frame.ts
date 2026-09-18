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
 * the whole job. Immediately after `<head>` when there is one, and at the
 * very front otherwise -- a document with no head still gets one
 * synthesised around whatever leads it, so a meta that leads the string
 * lands in that head ahead of the rest.
 */
export function mockupFrameDocument(html: string): string {
  const head = /<head[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}${META}${html.slice(at)}`;
  }
  return `${META}${html}`;
}
