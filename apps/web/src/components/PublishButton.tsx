import { useEffect, useRef, useState } from 'react';
import type { ProjectFile, ProjectSnapshot } from '@vibld/core';
import {
  publishProject,
  unpublishProject,
} from '../generation/publish-client.ts';
import { createStatusGate } from '../github/panel-view.ts';
import type { ProjectSite } from '../projects/projects-client.ts';

/**
 * A decision that has been raised and not yet taken.
 *
 * Both verbs go through one of these, because both are the same kind of act:
 * they change what a stranger can see, and neither should happen on a single
 * press (ADR-0013). A publish carries the files it named, so that taking the
 * decision does exactly what the sentence said; a takedown needs nothing but
 * the name, because what comes down is whatever is up.
 */
type Decision =
  | {
      act: 'publish';
      slug: string;
      revision: string;
      /**
       * The work the sentence on screen is about.
       *
       * Held here rather than read from the snapshot when the second press
       * arrives. The effect below withdraws a confirmation whose checkpoint
       * has moved on, but it runs after the commit that moved it, and
       * carrying the work closes that window without a second rule to keep
       * in step with the first: there is no reading of "current" left to go
       * stale.
       */
      files: ProjectFile[];
      /** Whether this name already has something live under it. */
      replacing: boolean;
      publishedSlug?: string;
    }
  | { act: 'takedown'; slug: string };

type PublishState =
  /**
   * `publishedSlug` is the name a previous checkpoint went out under, kept
   * across a new one so the button stays "Republish" and stops asking for a
   * slug that is already chosen.
   */
  | { phase: 'idle'; publishedSlug?: string }
  | { phase: 'confirming'; decision: Decision }
  /**
   * `publishedSlug` here is the same fact carried through the wait: what a
   * publish that already landed went out under, so a request abandoned
   * mid-flight can be put back where it started rather than leaving behind a
   * name we never saw go out.
   */
  | { phase: 'publishing'; publishedSlug?: string }
  | { phase: 'removing'; slug: string }
  | { phase: 'published'; slug: string; url: string; skipped: string[] }
  /** Off the web, and the name still ours. Publishing again puts it back. */
  | { phase: 'taken-down'; slug: string }
  /**
   * An operator has taken this site down (internal issue 172). Publishing again would be
   * refused, and so would the owner's own takedown, so neither is offered:
   * the site is off the web, and only an operator can change that.
   */
  | { phase: 'held'; slug: string }
  /**
   * Something went wrong, and the site is wherever it already was.
   *
   * `publishedSlug` is carried through on purpose. Dropping it hid the
   * "Take it down" button behind a failure, and a revoked owner cannot get
   * it back: the POST that would re-establish the name is gated and a fresh
   * page load has no slug lookup, so a transient error or a rate limit was
   * enough to leave somebody's site live with no control that reaches it.
   */
  | { phase: 'failed'; error: string; publishedSlug?: string };

/**
 * Put the project on the web, and take it off again (ADR-0010,
 * docs/decisions.md L40, ADR-0013).
 *
 * Offered alongside `ExportButton`, for the same reason and under the same
 * condition: an accepted checkpoint only -- staged files have not been
 * validated yet.
 *
 * Two presses for either verb. The first raises a sentence naming what
 * changes; the second is the act. That is the whole of the difference
 * between these buttons and every other one in the builder: these are the
 * only ones whose result a stranger can see. A generic "are you sure" would
 * not earn the extra press -- naming what becomes public, or stops being
 * public, does.
 *
 * A slug is required on first publish (it becomes
 * `<slug>.vibld-preview.dev`) and reused on every later one.
 *
 * **One site per project** (docs/decisions.md, "Resolved 2026-09-28").
 * `projectId` names whose site this is, on every publish and takedown, so
 * publishing one project can never replace another's. `site` is that
 * project's site as the project was opened with it, which is how a fresh
 * page load knows the slug already chosen and whether there is anything up
 * to take down; before projects carried it, a returning visitor had to
 * re-enter the slug and could not take down what they had not published
 * from that page. The caller mounts one of these per project (a `key`), so
 * nothing one project's button learned is shown against another.
 *
 * Without a project (a deployment that builds in the browser and has no
 * server projects) neither is passed, and the Worker reads the request as
 * it always did.
 */
export function PublishButton({
  snapshot,
  projectId = null,
  site = null,
}: {
  snapshot: ProjectSnapshot;
  projectId?: string | null;
  site?: ProjectSite | null;
}) {
  const [state, setState] = useState<PublishState>(() => initialState(site));
  const [slugInput, setSlugInput] = useState('');
  const publishes = useRef(createStatusGate());

  const knownSlug =
    state.phase === 'published' ||
    state.phase === 'taken-down' ||
    state.phase === 'held'
      ? state.slug
      : state.phase === 'idle' || state.phase === 'failed'
        ? state.publishedSlug
        : undefined;
  /** Whether there is something up that could be taken down. */
  const live =
    knownSlug !== undefined &&
    state.phase !== 'taken-down' &&
    state.phase !== 'held';

  // What is live is the checkpoint that was published, and a later one has
  // not been. Leaving "Live at ..." up beside a project that has moved on
  // reads as though the new work is already on the web, which is the same
  // thing the push button was fixed for on internal PR 123: the address is still
  // serving, but it is serving the previous checkpoint.
  //
  // The slug is deliberately not forgotten with it. It is the name of the
  // site rather than a fact about this checkpoint, and asking for it again
  // after every accepted change would be asking somebody to retype what
  // they already told us.
  //
  // Clearing alone is not enough, for the reason the push button found on
  // internal PR 123: a publish still in flight lands afterwards and draws the previous
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
      if (previous.phase === 'removing') {
        return { phase: 'idle', publishedSlug: previous.slug };
      }
      // An open confirmation names a checkpoint by revision. Once that is no
      // longer the checkpoint in hand, the sentence on screen is about work
      // that is not the work that would go out, so the decision is withdrawn
      // rather than carried over to something nobody was shown. A takedown
      // goes with it: it was raised beside a sentence that is now gone.
      if (previous.phase === 'confirming') {
        const held =
          previous.decision.act === 'publish'
            ? previous.decision.publishedSlug
            : previous.decision.slug;
        return held === undefined
          ? { phase: 'idle' }
          : { phase: 'idle', publishedSlug: held };
      }
      // `taken-down` deliberately survives. A new checkpoint does not put a
      // site back on the web, and saying so is the point of that state.
      return previous;
    });
  }, [snapshot.revision]);

  function idleWith(slug: string | undefined): PublishState {
    return slug === undefined
      ? { phase: 'idle' }
      : { phase: 'idle', publishedSlug: slug };
  }

  /** First press: raise the decision. Nothing has left the browser yet. */
  function askToPublish() {
    const slug = knownSlug ?? slugInput.trim();
    if (slug === '') {
      setState({ phase: 'failed', error: 'Choose a slug to publish under.' });
      return;
    }
    setState({
      phase: 'confirming',
      decision: {
        act: 'publish',
        slug,
        revision: snapshot.revision,
        files: snapshot.files,
        replacing: live,
        ...(knownSlug === undefined ? {} : { publishedSlug: knownSlug }),
      },
    });
  }

  function askToTakeDown(slug: string) {
    setState({ phase: 'confirming', decision: { act: 'takedown', slug } });
  }

  /**
   * Second press: the act.
   *
   * It carries out the confirmation it is answering, not whatever the
   * component happens to be holding now. That is the point of the two
   * presses: what changes is what the sentence named, and there is no moment
   * in between where the answer could apply to something else.
   */
  async function take(decision: Decision) {
    const current = publishes.current.begin();
    if (decision.act === 'takedown') {
      setState({ phase: 'removing', slug: decision.slug });
      try {
        const result = await unpublishProject(undefined, undefined, projectId);
        if (!current()) return;
        setState(
          result.ok
            ? { phase: 'taken-down', slug: result.slug }
            : {
                phase: 'failed',
                error: result.error,
                publishedSlug: decision.slug,
              },
        );
      } catch (error) {
        if (!current()) return;
        setState({
          phase: 'failed',
          error:
            error instanceof Error
              ? error.message
              : 'The project could not be taken down.',
          publishedSlug: decision.slug,
        });
      }
      return;
    }

    setState(
      decision.publishedSlug === undefined
        ? { phase: 'publishing' }
        : { phase: 'publishing', publishedSlug: decision.publishedSlug },
    );
    try {
      const result = await publishProject(
        decision.files,
        decision.slug,
        undefined,
        undefined,
        projectId,
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
          : decision.publishedSlug === undefined
            ? { phase: 'failed', error: result.error }
            : {
                phase: 'failed',
                error: result.error,
                publishedSlug: decision.publishedSlug,
              },
      );
    } catch (error) {
      if (!current()) return;
      setState({
        phase: 'failed',
        error:
          error instanceof Error
            ? error.message
            : 'The project could not be published.',
        ...(decision.publishedSlug === undefined
          ? {}
          : { publishedSlug: decision.publishedSlug }),
      });
    }
  }

  if (state.phase === 'confirming') {
    const { decision } = state;
    const withdraw = () =>
      setState(
        idleWith(
          decision.act === 'publish' ? decision.publishedSlug : decision.slug,
        ),
      );
    return (
      <div
        className="publish-button publish-confirm"
        role="group"
        aria-label="Confirm publishing"
      >
        <p className="pane-note">
          {decision.act === 'takedown' ? (
            <>
              Take <strong>{decision.slug}</strong> off the web. The address
              stops working. The name stays yours, and publishing again puts it
              back.
            </>
          ) : (
            <>
              {decision.replacing ? 'Replace what is live at ' : 'Publish '}
              <strong>{decision.slug}</strong> with checkpoint{' '}
              <code>{decision.revision}</code>. Anyone with the address can read
              it.
            </>
          )}
        </p>
        <button
          type="button"
          className="chip chip--on"
          onClick={() => void take(decision)}
        >
          {decision.act === 'takedown'
            ? `Take down ${decision.slug}`
            : `${decision.replacing ? 'Replace' : 'Publish'} ${decision.slug}`}
        </button>
        <button type="button" className="chip" onClick={withdraw}>
          Cancel
        </button>
      </div>
    );
  }

  const busy = state.phase === 'publishing' || state.phase === 'removing';

  if (state.phase === 'held') {
    return (
      <div className="publish-button">
        <p className="pane-note pane-note--error" role="status">
          <strong>{state.slug}</strong> has been taken down by the operator and
          cannot be published again until that is lifted. Write to the abuse
          address if you think this is a mistake.
        </p>
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
          disabled={busy}
          onChange={(event) => setSlugInput(event.target.value)}
        />
      ) : null}
      <button
        type="button"
        className="chip"
        onClick={askToPublish}
        disabled={busy}
      >
        {state.phase === 'publishing'
          ? 'Publishing…'
          : state.phase === 'taken-down'
            ? 'Publish again'
            : knownSlug
              ? 'Republish'
              : 'Publish'}
      </button>
      {live && knownSlug ? (
        <button
          type="button"
          className="chip"
          onClick={() => askToTakeDown(knownSlug)}
          disabled={busy}
        >
          {state.phase === 'removing' ? 'Taking down…' : 'Take it down'}
        </button>
      ) : null}
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
      {state.phase === 'taken-down' ? (
        <p className="pane-note">
          <strong>{state.slug}</strong> is off the web. The name is still yours.
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

/**
 * Where the button starts, from the site the project was opened with: the
 * name to republish under when it is live, "publish again" when its owner
 * took it down, and nothing to offer when an operator did.
 */
function initialState(site: ProjectSite | null): PublishState {
  if (!site) return { phase: 'idle' };
  if (site.state === 'held') return { phase: 'held', slug: site.slug };
  if (site.state === 'down') return { phase: 'taken-down', slug: site.slug };
  return { phase: 'idle', publishedSlug: site.slug };
}
