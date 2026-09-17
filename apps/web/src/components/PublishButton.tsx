import { useEffect, useRef, useState } from 'react';
import type { ProjectFile, ProjectSnapshot } from '@vibld/core';
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
   * The decision, held open until somebody takes it (ADR-0013). It carries
   * the checkpoint it was raised for, not just the slug, because that is
   * what the sentence on screen names: a confirmation that outlives the
   * checkpoint it described would put something live that nobody read out.
   */
  | {
      phase: 'confirming';
      slug: string;
      revision: string;
      /**
       * The files the sentence on screen is about.
       *
       * Held here rather than read from the snapshot when the second press
       * arrives, so confirming does exactly what the confirmation said. The
       * effect below withdraws a confirmation whose checkpoint has moved on,
       * but it runs after the commit that moved it, and carrying the work
       * closes that window without a second rule to keep in step with the
       * first: there is no reading of "current" left to go stale.
       */
      files: ProjectFile[];
      /** Whether this slug already has something live under it. */
      replacing: boolean;
      publishedSlug?: string;
    }
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
 * Two presses, not one (ADR-0013). The first raises a sentence naming the
 * checkpoint and the name it goes out under; the second is the act. That is
 * the whole of the difference between publishing and every other button in
 * the builder: this one is the only one a stranger can see the result of,
 * and it cannot be undone from here yet. A generic "are you sure" would not
 * earn the extra press -- naming what becomes public does.
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
      // An open confirmation names a checkpoint by revision. Once that is no
      // longer the checkpoint in hand, the sentence on screen is about work
      // that is not the work that would go out, so the decision is withdrawn
      // rather than carried over to something nobody was shown.
      if (previous.phase === 'confirming') {
        return { phase: 'idle', publishedSlug: previous.publishedSlug };
      }
      return previous;
    });
  }, [snapshot.revision]);

  /** First press: raise the decision. Nothing has left the browser yet. */
  function ask() {
    const slug = knownSlug ?? slugInput.trim();
    if (slug === '') {
      setState({ phase: 'failed', error: 'Choose a slug to publish under.' });
      return;
    }
    setState({
      phase: 'confirming',
      slug,
      revision: snapshot.revision,
      files: snapshot.files,
      replacing: knownSlug !== undefined,
      ...(knownSlug === undefined ? {} : { publishedSlug: knownSlug }),
    });
  }

  /**
   * Second press: the act.
   *
   * It publishes the confirmation it is answering, not whatever the
   * component happens to be holding now. That is the whole point of the two
   * presses: what goes live is what the sentence named, and there is no
   * moment in between where the answer could apply to different work.
   */
  async function confirm(decision: {
    slug: string;
    revision: string;
    files: ProjectFile[];
    publishedSlug?: string;
  }) {
    const current = publishes.current.begin();
    setState({
      phase: 'publishing',
      ...(decision.publishedSlug === undefined
        ? {}
        : { publishedSlug: decision.publishedSlug }),
    });
    try {
      const result = await publishProject(decision.files, decision.slug);
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

  if (state.phase === 'confirming') {
    const decision = state;
    return (
      <div
        className="publish-button publish-confirm"
        role="group"
        aria-label="Confirm publishing"
      >
        <p className="pane-note">
          {decision.replacing ? 'Replace what is live at ' : 'Publish '}
          <strong>{decision.slug}</strong> with checkpoint{' '}
          <code>{decision.revision}</code>. Anyone with the address can read it.
        </p>
        <button
          type="button"
          className="chip chip--on"
          onClick={() => void confirm(decision)}
        >
          {decision.replacing ? 'Replace' : 'Publish'} {decision.slug}
        </button>
        <button
          type="button"
          className="chip"
          onClick={() =>
            setState({
              phase: 'idle',
              ...(decision.publishedSlug === undefined
                ? {}
                : { publishedSlug: decision.publishedSlug }),
            })
          }
        >
          Cancel
        </button>
      </div>
    );
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
        onClick={ask}
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
