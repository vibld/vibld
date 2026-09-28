import { useMemo } from 'react';
import { mockupFrameDocument } from '../generation/mockup-frame.ts';

/**
 * One mockup, framed so that it cannot touch the builder.
 *
 * Lifted out of `MockupChooser` when the preview pane started showing a
 * mockup too, as the draft a build shows while it runs (docs/decisions.md,
 * 2026-09-28, the draft preview). Every mockup is model output, so every
 * one is untrusted, and one frame that gets this right is better than two
 * that have to be kept in step.
 *
 * `srcDoc` with an empty `sandbox`, which is the same thing `PreviewPanel`
 * does for the local mock: no scripts, no same-origin access, no forms, no
 * navigation. The mockup prompts forbid scripts outright, and this is what
 * makes that a guarantee rather than a request: a `<script>` that slipped
 * through does not run. The sandbox is not a network policy, so the
 * document goes through `mockupFrameDocument` first, which adds the content
 * policy that stops a remote image or font disclosing the viewer's IP
 * (internal PR 189 review).
 *
 * Never `dangerouslySetInnerHTML`. Putting this markup in the shell's own
 * document would give model output the shell's origin, its Clerk session
 * and its DOM, which is the one thing ADR-0004 exists to prevent.
 */
export function MockupFrame({
  html,
  title,
  className,
  lazy = false,
}: {
  html: string;
  title: string;
  className: string;
  lazy?: boolean;
}) {
  const document = useMemo(() => mockupFrameDocument(html), [html]);
  return (
    /*
      `sandbox=""` and not merely `sandbox`: the empty value is the
      deny-everything list. Dropping the attribute, or adding
      `allow-scripts` with `allow-same-origin`, would hand model output
      this document's origin.
    */
    <iframe
      className={className}
      title={title}
      srcDoc={document}
      sandbox=""
      {...(lazy ? { loading: 'lazy' as const } : {})}
    />
  );
}
