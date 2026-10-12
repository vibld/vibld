import { useEffect, useState } from 'react';
import { listSitePublishes } from '../generation/publish-client.ts';
import type { SitePublish } from '../generation/publish-client.ts';

/**
 * The checkpoints a project's site went out at, and putting one of them back
 * (D219).
 *
 * Closed until asked for, so opening the Ship panel costs no request. Picking
 * a version does not publish it: `onPick` hands it to `PublishButton`, which
 * raises the same two-press decision every publish goes through, naming the
 * checkpoint that would replace what is live.
 *
 * `version` changes after each publish this page made, so an open list
 * shows the publish that just landed.
 */
export function PublishHistory({
  projectId,
  live,
  version,
  disabled,
  onPick,
}: {
  projectId: string;
  /** Whether the newest entry is what the address serves now. */
  live: boolean;
  version: number;
  disabled: boolean;
  onPick: (entry: SitePublish) => void;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<
    | { phase: 'loading' }
    | { phase: 'ready'; publishes: SitePublish[] }
    | { phase: 'failed'; error: string }
  >({ phase: 'loading' });

  useEffect(() => {
    if (!open) return;
    let current = true;
    setList({ phase: 'loading' });
    listSitePublishes(projectId).then(
      (publishes) => {
        if (current) setList({ phase: 'ready', publishes });
      },
      (error: unknown) => {
        if (!current) return;
        setList({
          phase: 'failed',
          error:
            error instanceof Error
              ? error.message
              : 'The publish history could not be read.',
        });
      },
    );
    return () => {
      current = false;
    };
  }, [open, projectId, version]);

  return (
    <div className="publish-history">
      <button
        type="button"
        className="chip"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        Published versions
      </button>
      {open ? (
        list.phase === 'loading' ? (
          <p className="pane-note" role="status">
            Loading…
          </p>
        ) : list.phase === 'failed' ? (
          <p className="pane-note pane-note--error" role="alert">
            {list.error}
          </p>
        ) : list.publishes.length === 0 ? (
          <p className="pane-note">
            Publishes from now on are listed here, so you can put an earlier one
            back.
          </p>
        ) : (
          <ol className="publish-history__list" aria-label="Published versions">
            {list.publishes.map((entry, index) => (
              <li key={`${entry.publishedAt}-${index}`}>
                <code>{entry.revision}</code>{' '}
                <time dateTime={entry.publishedAt}>
                  {new Date(entry.publishedAt).toLocaleString()}
                </time>{' '}
                {entry.live && live ? (
                  <span className="pane-note">Live now</span>
                ) : entry.available ? (
                  <button
                    type="button"
                    className="chip"
                    disabled={disabled}
                    onClick={() => onPick(entry)}
                  >
                    Put this back
                  </button>
                ) : (
                  <span className="pane-note">No longer stored</span>
                )}
              </li>
            ))}
          </ol>
        )
      ) : null}
    </div>
  );
}
