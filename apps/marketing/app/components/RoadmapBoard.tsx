import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ROADMAP_GROUPS,
  type RoadmapItem,
  isVotable,
  itemsIn,
} from '../roadmap.ts';
import {
  EMPTY_TALLY,
  ROADMAP_TURNSTILE_ACTION,
  type RoadmapError,
  type Tally,
  type VotePayload,
  errorOf,
  failureMessage,
  readVotesPayload,
  restored,
  settled,
  snapshotOf,
  tallyFrom,
  toggled,
  voteLabel,
} from '../roadmap-votes.ts';
import { SITE } from '../site.ts';
import { SectionHead } from './Sections';

/**
 * The part of Turnstile's global API this file calls. Read through a cast
 * rather than declared on `Window`, because WaitlistForm.tsx already declares
 * `window.turnstile` with the one method it uses, and a second declaration of
 * the same property with a different type does not compile.
 */
interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      appearance: 'interaction-only';
      callback: (token: string) => void;
      'error-callback': () => void;
      'expired-callback': () => void;
      'timeout-callback': () => void;
    },
  ): string | undefined;
  remove(widgetId: string): void;
}

function turnstile(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

/**
 * root.tsx loads Turnstile's script with `async`, so on a fast first press it
 * may not have arrived yet. A few seconds, then give up and say so, rather
 * than leave a vote waiting on a script an extension may have blocked.
 */
async function turnstileReady(): Promise<TurnstileApi> {
  for (let waited = 0; waited < 8000; waited += 200) {
    const api = turnstile();
    if (api) return api;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Turnstile did not load');
}

class VoteFailure extends Error {
  constructor(readonly code: RoadmapError | null) {
    super(code ?? 'vote failed');
  }
}

/**
 * Every group and every item, prerendered whole: a crawler, a reader without
 * JavaScript and a reader whose counts never arrive all get the complete
 * roadmap. The counts, and which items this browser voted for, are fetched
 * after hydration and drawn into buttons that were already there.
 *
 * A press shows at once and is sent in the background. Votes are sent one at
 * a time, in the order they were pressed: a browser's first vote carries a
 * Turnstile token and gets its cookie in the reply, and every vote after it
 * needs that cookie, so letting a second press race the first would send it
 * without either.
 */
export function RoadmapBoard() {
  const [tally, setTally] = useState<Tally>(EMPTY_TALLY);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);

  // Read by the queued sends, which outlive the render that queued them.
  const tallyRef = useRef(tally);
  tallyRef.current = tally;
  const queue = useRef<Promise<void>>(Promise.resolve());
  const check = useRef<{
    resolve: (token: string) => void;
    reject: (error: VoteFailure) => void;
  } | null>(null);
  const widgetHost = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/roadmap/votes', {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
      .then(async (response) => {
        const payload = response.ok
          ? readVotesPayload(await response.json())
          : null;
        if (cancelled) return;
        if (payload) setTally(tallyFrom(payload));
        else setLoadFailed(true);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The widget is drawn only while a first vote waits on it, into a panel
  // that exists only then, and removed as soon as it has answered. Nobody
  // who never votes, or who voted before, is shown it at all.
  useEffect(() => {
    if (!checking) return;
    let widget: string | undefined;
    let api: TurnstileApi | undefined;
    let done = false;
    const finish = (token: string | null, code: RoadmapError) => {
      if (done) return;
      done = true;
      const waiting = check.current;
      check.current = null;
      setChecking(false);
      if (token) waiting?.resolve(token);
      else waiting?.reject(new VoteFailure(code));
    };
    turnstileReady()
      .then((ready) => {
        if (done || !widgetHost.current) return;
        api = ready;
        widget = ready.render(widgetHost.current, {
          sitekey: SITE.turnstileSiteKey,
          action: ROADMAP_TURNSTILE_ACTION,
          // Invisible unless Cloudflare needs the person to do something.
          appearance: 'interaction-only',
          callback: (token) => finish(token, 'check-failed'),
          'error-callback': () => finish(null, 'check-failed'),
          'expired-callback': () => finish(null, 'check-failed'),
          'timeout-callback': () => finish(null, 'check-failed'),
        });
      })
      .catch(() => finish(null, 'check-unavailable'));
    return () => {
      done = true;
      if (api && widget) api.remove(widget);
    };
  }, [checking]);

  const token = useCallback(
    () =>
      new Promise<string>((resolve, reject) => {
        check.current = { resolve, reject };
        setChecking(true);
      }),
    [],
  );

  const send = useCallback(
    async (id: string): Promise<VotePayload> => {
      const post = async (turnstileToken: string) => {
        const response = await fetch('/api/roadmap/vote', {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ id, turnstile: turnstileToken }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (response.ok) return body as VotePayload;
        throw new VoteFailure(errorOf(body));
      };
      if (tallyRef.current.verified) {
        try {
          return await post('');
        } catch (error) {
          // The Worker no longer knows this browser (a cleared database, a
          // cookie that expired between loading the page and pressing):
          // one check, and the vote goes again.
          if (!(error instanceof VoteFailure)) throw error;
          if (error.code !== 'check-required') throw error;
        }
      }
      return post(await token());
    },
    [token],
  );

  const vote = useCallback(
    (id: string) => {
      // A press on an item already on its way is dropped rather than queued:
      // two quick presses would otherwise send a vote and its undoing, and
      // show neither.
      if (pending.has(id)) return;
      const before = snapshotOf(tallyRef.current, id);
      setTally((current) => toggled(current, id));
      setPending((current) => new Set(current).add(id));
      setErrors(({ [id]: _cleared, ...rest }) => rest);

      queue.current = queue.current.then(async () => {
        try {
          const result = await send(id);
          setTally((current) => settled(current, result));
        } catch (error) {
          setTally((current) => restored(current, id, before));
          setErrors((current) => ({
            ...current,
            [id]: failureMessage(
              error instanceof VoteFailure ? error.code : null,
            ),
          }));
        } finally {
          setPending((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          });
        }
      });
    },
    [pending, send],
  );

  return (
    <>
      {loadFailed ? (
        <div className="lb-wrap">
          <p className="lb-rm-status" role="status">
            The vote counts could not be loaded. Voting may not work until they
            can be.
          </p>
        </div>
      ) : null}
      {ROADMAP_GROUPS.map((group, index) => (
        <section
          key={group.status}
          className={`lb-section lb-rm-group lb-rm-group--${group.status}`}
          aria-labelledby={`roadmap-${group.status}`}
        >
          <div className="lb-wrap">
            <SectionHead
              number={String(index + 1).padStart(2, '0')}
              eyebrow={group.label}
              id={`roadmap-${group.status}`}
              title={group.title}
              lede={group.lead}
            />
            <ul className="lb-rm-list">
              {itemsIn(group.status).map((item) => (
                <RoadmapCard
                  key={item.id}
                  item={item}
                  tally={tally}
                  pending={pending.has(item.id)}
                  error={errors[item.id]}
                  onVote={vote}
                />
              ))}
            </ul>
          </div>
        </section>
      ))}
      {checking ? (
        <div className="lb-rm-check" role="status">
          <p>
            One check before your first vote: Cloudflare Turnstile is making
            sure you are a person.
          </p>
          <div ref={widgetHost} />
        </div>
      ) : null}
    </>
  );
}

function RoadmapCard({
  item,
  tally,
  pending,
  error,
  onVote,
}: {
  item: RoadmapItem;
  tally: Tally;
  pending: boolean;
  error: string | undefined;
  onVote: (id: string) => void;
}) {
  const count = tally.counts?.[item.id];
  return (
    <li className="lb-rm-item" id={`roadmap-item-${item.id}`}>
      <div className="lb-rm-item__head">
        <h3>{item.title}</h3>
        {isVotable(item) ? (
          <button
            type="button"
            className="lb-vote"
            aria-pressed={tally.voted.has(item.id)}
            aria-label={voteLabel(item.title, count)}
            aria-describedby={error ? `roadmap-error-${item.id}` : undefined}
            data-pending={pending ? 'true' : undefined}
            data-error={error ? 'true' : undefined}
            onClick={() => onVote(item.id)}
          >
            <ThumbIcon />
            <span className="lb-vote__n">
              {count === undefined ? 'Vote' : count}
            </span>
          </button>
        ) : (
          <span className="lb-rm-done">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12.5l5 5L20 6.5" />
            </svg>
            Shipped
          </span>
        )}
      </div>
      <p>{item.description}</p>
      {error ? (
        <p
          className="lb-rm-item__err"
          id={`roadmap-error-${item.id}`}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** A raised thumb, drawn for this page rather than taken from an icon set. */
function ThumbIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="lb-vote__i">
      <path d="M3 10.5h3.5V20H3z" />
      <path d="M6.5 10.5 10.4 3.6a2.3 2.3 0 0 1 2.9 2.7L12.6 9.5h5.8a2 2 0 0 1 2 2.4l-1.3 6.4a2.1 2.1 0 0 1-2 1.7H6.5" />
    </svg>
  );
}
