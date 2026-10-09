import { useMemo } from 'react';
import type { ProjectSnapshot } from '@vibld/core';
import { DESIGN_MD_PATH, readDesignSpec } from '@vibld/ai/design-spec';

/**
 * The sample content in the current project, to replace (D177).
 *
 * Where a request left a detail out, a build writes plausible content in
 * its place rather than a hedge on the page, and lists each piece in its
 * spec. Read from the project's DESIGN.md, so the list is the code's own:
 * a follow-up that supplies the real content drops its entry, and a
 * project from before D177 shows nothing.
 */
export function SampleContent({
  snapshot,
}: {
  snapshot: ProjectSnapshot | null;
}) {
  const sample = useMemo(() => sampleIn(snapshot), [snapshot]);
  if (sample.length === 0) return null;
  return (
    <section className="banner" aria-label="Sample content to replace">
      <p className="banner__message">Sample content to replace</p>
      <p className="banner__detail">
        Written to fill the page where your request did not say. Tell vibld the
        real details below, or edit them in the code.
      </p>
      <ul className="sample-list">
        {sample.map((entry) => (
          <li key={entry}>{entry}</li>
        ))}
      </ul>
    </section>
  );
}

export function sampleIn(snapshot: ProjectSnapshot | null): string[] {
  const design = snapshot?.files.find((file) => file.path === DESIGN_MD_PATH);
  if (!design) return [];
  return [...new Set(readDesignSpec(design.content)?.sample ?? [])];
}
