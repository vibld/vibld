import { useEffect, useRef } from 'react';
import type { BuilderState } from '../generation/session.ts';
import { LifecycleBar } from './LifecycleBar.tsx';
import { ProgressMeter } from './ProgressMeter.tsx';
import { StatusBanner } from './StatusBanner.tsx';
import { Transcript } from './Transcript.tsx';

/**
 * The scrolling half of the builder: what has been said, and what is being
 * said right now. The composer below it stays put, which is what lets a long
 * conversation stay usable.
 */
export function Conversation({ state }: { state: BuilderState }) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const turns = state.transcript;
  const last = turns.at(-1);

  // Follow the conversation as it grows. Keyed on the turn count and the
  // last turn's outcome rather than on every state change, so a progress
  // update several times a second does not fight a scrollbar the user is
  // holding.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns.length, last?.status]);

  return (
    <div className="conversation">
      {turns.length === 0 &&
      state.status === 'idle' &&
      state.acceptedSnapshot ? (
        // A project that has code and no conversation: one built before
        // projects kept what was said, reopened. The code is what matters
        // and it is back, which is the thing to say, rather than asking
        // what to build as though there were nothing here.
        <div className="banner" role="status">
          <p className="banner__message">Your project is back.</p>
          <p className="banner__detail">
            Its code is restored ({state.acceptedSnapshot.files.length} files),
            with no conversation saved beside it. Describe a change below to
            keep building.
          </p>
        </div>
      ) : turns.length === 0 && state.status === 'idle' ? (
        // The empty state is an invitation, not a status: there is nothing
        // to report yet, and a bordered status card said so loudly.
        <div className="welcome">
          <h1 className="welcome__title">What do you want to build?</h1>
          <p className="welcome__text">
            Describe it below. vibld plans it, writes the code, checks that it
            builds and shows you a preview. Then keep chatting to change it.
          </p>
        </div>
      ) : null}
      {turns.length === 0 && state.status !== 'idle' ? (
        <StatusBanner state={state} />
      ) : null}
      <Transcript turns={turns} />
      {/*
        Only while a run is going: at rest it was four grey dots that meant
        nothing yet, above the composer on every screen.
      */}
      {/*
        A build that carried on while the page was away, one being stopped,
        or one that could not be: said once, beside the run it is about.
      */}
      {state.notice ? (
        <div className="banner" role="status" aria-live="polite">
          <p className="banner__message">{state.notice}</p>
        </div>
      ) : null}
      {state.running ? (
        <LifecycleBar status={state.status} phase={state.progress?.phase} />
      ) : null}
      <ProgressMeter progress={state.progress} />
      <div ref={endRef} />
    </div>
  );
}
