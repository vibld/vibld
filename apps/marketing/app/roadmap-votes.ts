/**
 * The page's side of roadmap voting: the API's shapes, and the state the vote
 * buttons draw, as pure functions the tests can drive without a browser.
 *
 * The Worker's side is worker/roadmap.ts. The two share the Turnstile action
 * and the error codes from here, so the page cannot ask for one action while
 * the Worker verifies another.
 */

/** The `action` the vote widget declares, and the Worker verifies. */
export const ROADMAP_TURNSTILE_ACTION = 'roadmap-vote';

/** Every reason either endpoint gives for not doing what it was asked. */
export type RoadmapError =
  | 'bad-origin'
  | 'unsupported-media-type'
  | 'body-too-large'
  | 'invalid-body'
  | 'unknown-item'
  | 'shipped-item'
  | 'rate-limited'
  | 'check-required'
  | 'check-failed'
  | 'check-unavailable'
  | 'unavailable';

/** `GET /api/roadmap/votes`. */
export interface VotesPayload {
  counts: Record<string, number>;
  voted: string[];
  /** False until this browser has passed Turnstile once. */
  verified: boolean;
}

/** `POST /api/roadmap/vote`. */
export interface VotePayload {
  id: string;
  voted: boolean;
  count: number;
}

/** What the buttons draw. `counts` is null until the counts have arrived. */
export interface Tally {
  counts: Record<string, number> | null;
  voted: ReadonlySet<string>;
  verified: boolean;
}

export const EMPTY_TALLY: Tally = {
  counts: null,
  voted: new Set(),
  verified: false,
};

/** A GET body, or null for anything that is not one. */
export function readVotesPayload(value: unknown): VotesPayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const { counts, voted, verified } = value as Record<string, unknown>;
  if (typeof counts !== 'object' || counts === null) return null;
  if (!Array.isArray(voted) || typeof verified !== 'boolean') return null;
  const clean: Record<string, number> = {};
  for (const [id, count] of Object.entries(counts)) {
    if (typeof count === 'number' && Number.isFinite(count) && count >= 0) {
      clean[id] = count;
    }
  }
  return {
    counts: clean,
    voted: voted.filter((id): id is string => typeof id === 'string'),
    verified,
  };
}

export function tallyFrom(payload: VotesPayload): Tally {
  return {
    counts: payload.counts,
    voted: new Set(payload.voted),
    verified: payload.verified,
  };
}

/** One item's part of the tally, kept so a failed vote can be put back. */
export interface Snapshot {
  voted: boolean;
  count: number | undefined;
}

export function snapshotOf(tally: Tally, id: string): Snapshot {
  return { voted: tally.voted.has(id), count: tally.counts?.[id] };
}

/**
 * The press, shown before the Worker has answered: the button flips, and the
 * count moves by one if the counts are known. Never below zero, which a
 * count that arrived stale could otherwise reach.
 */
export function toggled(tally: Tally, id: string): Tally {
  const was = tally.voted.has(id);
  const voted = new Set(tally.voted);
  if (was) voted.delete(id);
  else voted.add(id);
  if (tally.counts === null) return { ...tally, voted };
  const count = tally.counts[id] ?? 0;
  return {
    ...tally,
    voted,
    counts: {
      ...tally.counts,
      [id]: Math.max(0, count + (was ? -1 : 1)),
    },
  };
}

/** What the Worker says happened, which replaces what the page guessed. */
export function settled(tally: Tally, result: VotePayload): Tally {
  const voted = new Set(tally.voted);
  if (result.voted) voted.add(result.id);
  else voted.delete(result.id);
  return {
    voted,
    verified: true,
    counts:
      tally.counts === null
        ? null
        : { ...tally.counts, [result.id]: result.count },
  };
}

/** A vote that failed, undone to exactly what was showing before the press. */
export function restored(tally: Tally, id: string, before: Snapshot): Tally {
  const voted = new Set(tally.voted);
  if (before.voted) voted.add(id);
  else voted.delete(id);
  if (tally.counts === null || before.count === undefined) {
    return { ...tally, voted };
  }
  return { ...tally, voted, counts: { ...tally.counts, [id]: before.count } };
}

/**
 * The button's accessible name, which includes what the button shows (the
 * count, or "Vote" before there is one) so a speech-input user can say what
 * they see. Whether it is pressed is `aria-pressed`'s job, not the name's.
 */
export function voteLabel(title: string, count: number | undefined): string {
  if (count === undefined) return `Vote for ${title}`;
  return `Vote for ${title}, ${count} ${count === 1 ? 'vote' : 'votes'}`;
}

/** What a person is told when their vote did not count. */
export function failureMessage(error: RoadmapError | null): string {
  switch (error) {
    case 'rate-limited':
      return 'Too many votes from this network just now. Try again in a few minutes.';
    case 'check-required':
    case 'check-failed':
      return 'The check that you are a person did not pass, so the vote did not count. Try again.';
    case 'check-unavailable':
      return 'The check that you are a person could not run, so the vote did not count. Try again later.';
    case 'unavailable':
      return 'Voting is unavailable right now, so the vote did not count.';
    case 'unknown-item':
    case 'shipped-item':
      return 'This item can no longer be voted for. Reload the page to see the current roadmap.';
    default:
      return 'That vote did not go through. Check your connection and try again.';
  }
}

/** The error code in a failed response's body, if it has a known one. */
export function errorOf(value: unknown): RoadmapError | null {
  if (typeof value !== 'object' || value === null) return null;
  const error = (value as { error?: unknown }).error;
  return typeof error === 'string' && ERRORS.has(error)
    ? (error as RoadmapError)
    : null;
}

const ERRORS = new Set<string>([
  'bad-origin',
  'unsupported-media-type',
  'body-too-large',
  'invalid-body',
  'unknown-item',
  'shipped-item',
  'rate-limited',
  'check-required',
  'check-failed',
  'check-unavailable',
  'unavailable',
] satisfies RoadmapError[]);
