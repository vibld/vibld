import { useState } from 'react';
import type { ProjectSnapshot } from '@vibld/core';
import { publishProject } from '../generation/publish-client.ts';

type PublishState =
  | { phase: 'idle' }
  | { phase: 'publishing' }
  | { phase: 'published'; slug: string; url: string; skipped: string[] }
  | { phase: 'failed'; error: string };

/**
 * Put the project on the web (ADR-0010, docs/decisions.md L40).
 *
 * Offered alongside `ExportButton`, for the same reason and under the same
 * condition: an accepted checkpoint only -- staged files have not been
 * validated yet.
 *
 * A slug is required on first publish (it becomes
 * `<slug>.published.vibld-preview.dev`) and reused on every later one; this
 * component only remembers a slug across clicks within the same page load
 * (`state.phase === 'published'` holds it) -- there is no endpoint yet to
 * ask "what slug does this project already have" on a fresh page load, so a
 * returning visitor re-enters it. Worth a small follow-up, not a reason to
 * hold this back.
 */
export function PublishButton({ snapshot }: { snapshot: ProjectSnapshot }) {
  const [state, setState] = useState<PublishState>({ phase: 'idle' });
  const [slugInput, setSlugInput] = useState('');

  const knownSlug = state.phase === 'published' ? state.slug : undefined;

  async function publish() {
    if (!knownSlug && slugInput.trim() === '') {
      setState({ phase: 'failed', error: 'Choose a slug to publish under.' });
      return;
    }
    setState({ phase: 'publishing' });
    try {
      const result = await publishProject(
        snapshot.files,
        knownSlug ?? slugInput.trim(),
      );
      setState(
        result.ok
          ? {
              phase: 'published',
              slug: result.slug,
              url: result.url,
              skipped: result.skipped,
            }
          : { phase: 'failed', error: result.error },
      );
    } catch (error) {
      setState({
        phase: 'failed',
        error:
          error instanceof Error
            ? error.message
            : 'The project could not be published.',
      });
    }
  }

  return (
    <div className="publish-button">
      {!knownSlug ? (
        <input
          type="text"
          className="publish-button__slug"
          placeholder="your-project-name"
          pattern="[a-z0-9][a-z0-9-]{0,61}[a-z0-9]?"
          aria-label="Slug to publish under"
          value={slugInput}
          disabled={state.phase === 'publishing'}
          onChange={(event) => setSlugInput(event.target.value)}
        />
      ) : null}
      <button
        type="button"
        className="chip"
        onClick={publish}
        disabled={state.phase === 'publishing'}
      >
        {state.phase === 'publishing'
          ? 'Publishing…'
          : knownSlug
            ? 'Republish'
            : 'Publish'}
      </button>
      {state.phase === 'published' ? (
        <p className="pane-note">
          Live at{' '}
          <a href={state.url} target="_blank" rel="noreferrer">
            {state.url}
          </a>
          {state.skipped.length > 0 ? (
            <>
              {' '}
              (skipped {state.skipped.length === 1 ? 'file' : 'files'} not yet
              supported: {state.skipped.join(', ')})
            </>
          ) : null}
        </p>
      ) : null}
      {state.phase === 'failed' ? (
        <p className="pane-note pane-note--error" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
