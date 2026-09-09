import type { TranscriptTurn } from '../generation/session.ts';

/**
 * The conversation, oldest first.
 *
 * Building an application is iterative: the second prompt is where the value
 * is, and the engine has always supported it. Only the shell presented a run
 * as a one-shot request, because each run visually replaced the last. This
 * keeps every turn, so a person can see what they asked for and what came
 * back -- which is also what makes "change the hero to navy" a sensible next
 * thing to type.
 */
export function Transcript({ turns }: { turns: TranscriptTurn[] }) {
  if (turns.length === 0) return null;

  return (
    <ol className="transcript" aria-label="Conversation">
      {turns.map((turn) => (
        <li key={turn.id} className="transcript__turn">
          <article className="bubble bubble--you">
            <p className="bubble__who">You</p>
            <p className="bubble__text">{turn.prompt}</p>
          </article>
          <article className={`bubble bubble--vibld bubble--${turn.status}`}>
            <p className="bubble__who">
              Vibld
              {turn.providerId ? (
                <span className="bubble__provider"> · {turn.providerId}</span>
              ) : null}
            </p>
            <Reply turn={turn} />
          </article>
        </li>
      ))}
    </ol>
  );
}

function Reply({ turn }: { turn: TranscriptTurn }) {
  // The elapsed clock lives in the progress meter directly below, so this
  // does not compete with it -- and does not need a ticking timer of its own.
  if (turn.status === 'running') {
    return <p className="bubble__text bubble__text--pending">Working on it…</p>;
  }

  if (turn.status === 'cancelled') {
    // A cancellation is a choice the user made. It reads as neutral, not as
    // something that went wrong and needs interpreting.
    return <p className="bubble__text">Cancelled. Nothing was changed.</p>;
  }

  if (turn.status === 'failed') {
    return (
      <>
        <p className="bubble__text">
          This run failed. Your last accepted checkpoint is unchanged.
        </p>
        {turn.problem ? <p className="bubble__detail">{turn.problem}</p> : null}
      </>
    );
  }

  return (
    <>
      {turn.summary ? <p className="bubble__text">{turn.summary}</p> : null}
      <p className="bubble__detail">
        {turn.fileCount} {turn.fileCount === 1 ? 'file' : 'files'}
        {turn.revision ? (
          <>
            {' · '}
            <code>{turn.revision}</code>
          </>
        ) : null}
      </p>
    </>
  );
}
