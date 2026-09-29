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
            {/* The provider is in Run stats; here it was jargon beside a
                name. */}
            <p className="bubble__who">vibld</p>
            <Reply turn={turn} />
          </article>
        </li>
      ))}
    </ol>
  );
}

function Reply({ turn }: { turn: TranscriptTurn }) {
  // What the agent said, above whatever the build then did: the whole of a
  // reply, or its one line about the change it is making.
  const said = turn.agentMessage ? (
    <p className="bubble__text">{turn.agentMessage}</p>
  ) : null;

  if (turn.status === 'replied') return said;

  // The elapsed clock lives in the progress meter directly below, so this
  // does not compete with it -- and does not need a ticking timer of its own.
  if (turn.status === 'running') {
    return (
      <>
        {said}
        <p className="bubble__text bubble__text--pending">
          {said ? 'Working on it…' : 'Thinking…'}
        </p>
      </>
    );
  }

  if (turn.status === 'cancelled') {
    // A cancellation is a choice the user made. It reads as neutral, not as
    // something that went wrong and needs interpreting.
    return (
      <>
        {said}
        <p className="bubble__text">Cancelled. Nothing was changed.</p>
      </>
    );
  }

  if (turn.status === 'failed') {
    return (
      <>
        {said}
        <p className="bubble__text">
          This did not work. Your project is unchanged.
        </p>
        {turn.problem ? <p className="bubble__detail">{turn.problem}</p> : null}
      </>
    );
  }

  return (
    <>
      {said}
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
      {/* What its build check found, where the code did not pass (D69):
          kept, and said, so the turn does not read as a clean success. */}
      {turn.problem ? (
        <p className="bubble__detail bubble__detail--check">{turn.problem}</p>
      ) : null}
    </>
  );
}
