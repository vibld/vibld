import type { ReactNode } from 'react';
import type { DraftPreview as Draft } from '../generation/session.ts';
import { MockupFrame } from './MockupFrame.tsx';

/** What the pane says over a draft while the build it stands in for runs. */
export const DRAFT_BUILDING_LABEL = 'Draft, building the real site';

/**
 * What it says once that build is accepted and before the live preview is
 * running, which is the gap the draft goes on filling.
 */
export const DRAFT_BUILT_LABEL = 'Draft, the real site is built';

/**
 * A static sketch of the page in the preview pane, while a first build
 * runs (docs/decisions.md, 2026-09-28, the draft preview).
 *
 * Labelled as a draft in words, above the frame, and never in the frame:
 * what is in the frame is model output, and a label inside it would be
 * something the model could imitate or cover. The overlay beneath carries
 * what is true about the real build, so the sketch is never mistaken for
 * the finished thing.
 */
export function DraftPreview({
  draft,
  label,
  children,
}: {
  draft: Draft;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="preview__draft">
      <p className="preview__notice preview__draft-label">
        <strong>{label}</strong>
      </p>
      <div className="preview__draft-stage">
        <MockupFrame
          className="preview__frame preview__draft-frame"
          title={`Draft of the page: ${draft.label}`}
          html={draft.html}
        />
        <div className="preview__draft-overlay">{children}</div>
      </div>
    </div>
  );
}
