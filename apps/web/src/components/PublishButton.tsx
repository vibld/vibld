import { useEffect, useRef, useState } from 'react';
import type { ProjectSnapshot } from '@vibld/core';
import { publishProject } from '../generation/publish-client.ts';
import { createStatusGate } from '../github/panel-view.ts';

type PublishState =
  /**
   * `publishedSlug` is the name a previous checkpoint went out under, kept
   * across a new one so the button stays "Republish" and stops asking for a
   * slug that is already chosen.
   */
  | { phase: 'idle'; publishedSlug?: string }
  /**
   * `publishedSlug` here is the same fact carried through the wait: what a
   * publish that already landed went out under, so a request abandoned
   * mid-flight can be put back where it started rather than leaving behind a
   * name we never saw go out.
   */
  | { phase: 'publishing'; publishedSlug?: string }
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
  const publishes = useRef(createStatusGate());

  const knownSlug =
    state.phase === 'published'
      ? state.slug
      : state.phase === 'idle'
        ? state.publishedSlug
        : undefined;

  // What is live is the checkpoint that was published, and a later one has
  // not been. Leaving "Live at ..." up beside a project that has moved on
  // reads as though the new work is already on the web, which is the same
  // thing the push button was fixed for on #123: the address is still
  // serving, but it is serving the previous checkpoint.
  //
  // The slug is deliberately not forgotten with it. It is the name of the
  // site rather than a fact about this checkpoint, and asking for it again
  // after every accepted change would be asking somebody to retype what
  // they already told us.
  //
  // Clearing alone is not enough, for the reason the push button found on
  // #123: a publish still in flight lands afterwards and draws the previous
  // checkpoint's address beside the new one, which is the sentence this is
  // here to stop. The gate is `createStatusGate`, the same latest-wins
  // primitive rather than a second copy of the rule, and the abandoned wait
  // is put back to idle so the button does not stay disabled on a result
  // nobody is going to show.
  useEffect(() => {
    publishes.current.supersede();
    setState((previous) => {
      if (previous.phase === 'published') {
        return { phase: 'idle', publishedSlug: previous.slug };
      }
      if (previous.phase === 'publishing') {
        return { phase: 'idle', publishedSlug: previous.publishedSlug };
      }
      return previous;
    });
  }, [snapshot.revision]);

  async function publish() {
    if (!knownSlug && slugInput.trim() === '') {
      setState({ phase: 'failed', error: 'Choose a slug to publish under.' });
      return;
    }
    const current = publishes.current.begin();
    setState({ phase: 'publishing', publishedSlug: knownSlug });
    try {
      const result = await publishProject(
        snapshot.files,
        knownSlug ?? slugInput.trim(),
      );
      if (!current()) return;
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
      if (!current()) return;
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
