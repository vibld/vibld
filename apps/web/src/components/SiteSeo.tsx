import { useId, useState } from 'react';
import { saveProject } from '../projects/projects-client.ts';
import type { ProjectSeo } from '../projects/projects-client.ts';

/** Kept in step with `SEO_TITLE_MAX` and `SEO_DESCRIPTION_MAX` in the Worker. */
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 320;

const NOTHING_SET: ProjectSeo = {
  title: null,
  description: null,
  image: null,
  indexing: true,
};

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'failed'; error: string };

/**
 * What search engines and link previews say about the project's published
 * site (docs/decisions.md D194, D202).
 *
 * The title and description replace the site's own on its home page; the
 * image is the preview on every page. Left empty, the site's own stand.
 * Sites are indexable by default and the owner can turn that off. Saved on
 * the project, and read by the site as it is served, so a change shows on
 * the live site without publishing again.
 */
export function SiteSeo({
  projectId,
  seo,
}: {
  projectId: string;
  seo?: ProjectSeo;
}) {
  const id = useId();
  const [saved, setSaved] = useState<ProjectSeo>(seo ?? NOTHING_SET);
  const [title, setTitle] = useState(saved.title ?? '');
  const [description, setDescription] = useState(saved.description ?? '');
  const [image, setImage] = useState(saved.image ?? '');
  const [indexing, setIndexing] = useState(saved.indexing);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const changed =
    title.trim() !== (saved.title ?? '') ||
    description.trim() !== (saved.description ?? '') ||
    image.trim() !== (saved.image ?? '') ||
    indexing !== saved.indexing;

  async function save() {
    // Only what changed in this form, so a field saved from another tab
    // since this one opened is not put back as it was here.
    const seo: Partial<ProjectSeo> = {};
    if (title.trim() !== (saved.title ?? '')) seo.title = title.trim() || null;
    if (description.trim() !== (saved.description ?? '')) {
      seo.description = description.trim() || null;
    }
    if (image.trim() !== (saved.image ?? '')) seo.image = image.trim() || null;
    if (indexing !== saved.indexing) seo.indexing = indexing;
    setStatus({ kind: 'saving' });
    const result = await saveProject(projectId, { seo }).catch(() => null);
    if (!result || !result.ok) {
      setStatus({
        kind: 'failed',
        error: result
          ? result.failure.message
          : 'vibld could not be reached. Check your connection and try again.',
      });
      return;
    }
    const next = result.value.seo ?? NOTHING_SET;
    setSaved(next);
    setTitle(next.title ?? '');
    setDescription(next.description ?? '');
    setImage(next.image ?? '');
    setIndexing(next.indexing);
    setStatus({ kind: 'saved' });
  }

  return (
    <details className="site-seo">
      <summary>Search and link previews</summary>
      <p className="pane-note">
        Left empty, your site's own title and description are used. Changes show
        on the live site at once.
      </p>
      {/* Held while a save is in flight, so its answer replaces nothing typed since. */}
      <fieldset
        className="site-seo__fields"
        disabled={status.kind === 'saving'}
      >
        <label htmlFor={`${id}-title`}>Title</label>
        <input
          id={`${id}-title`}
          type="text"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(event) => setTitle(event.target.value)}
        />
        <label htmlFor={`${id}-description`}>Description</label>
        <textarea
          id={`${id}-description`}
          rows={3}
          value={description}
          maxLength={DESCRIPTION_MAX}
          onChange={(event) => setDescription(event.target.value)}
        />
        <label htmlFor={`${id}-image`}>Preview image</label>
        <input
          id={`${id}-image`}
          type="text"
          inputMode="url"
          placeholder="https://… or /og.png"
          value={image}
          onChange={(event) => setImage(event.target.value)}
        />
        <label className="site-seo__check">
          <input
            type="checkbox"
            checked={indexing}
            onChange={(event) => setIndexing(event.target.checked)}
          />{' '}
          Let search engines list this site
        </label>
      </fieldset>
      <p className="site-seo__actions">
        <button
          type="button"
          className="chip"
          disabled={!changed || status.kind === 'saving'}
          onClick={() => void save()}
        >
          {status.kind === 'saving' ? 'Saving…' : 'Save'}
        </button>{' '}
        {status.kind === 'saved' && !changed ? (
          <span role="status">Saved.</span>
        ) : null}
      </p>
      {status.kind === 'failed' ? (
        <p className="pane-note pane-note--error" role="alert">
          {status.error}
        </p>
      ) : null}
    </details>
  );
}
