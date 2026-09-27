import { useEffect, useRef } from 'react';
import type { BuilderState } from '../generation/session.ts';
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
      {turns.length === 0 ? <StatusBanner state={state} /> : null}
      <Transcript turns={turns} />
      <ProgressMeter progress={state.progress} />
      <div ref={endRef} />
    </div>
  );
}
