/**
 * A project as the Worker stores it and the builder restores it: what a
 * conversation turn looks like once it is written down, how big one may be,
 * and what a project is called before anybody names it (docs/decisions.md,
 * "Resolved 2026-09-28", projects).
 *
 * Here rather than in either app because both sides have to agree on it
 * exactly. The builder writes the transcript and reads it back; the Worker
 * validates it on the way in and hands it out again. Two copies of the
 * shape would be two chances for a field the builder relies on to be one
 * the Worker quietly refuses, and the failure would be an autosave that
 * says "Couldn't save" for a reason nobody can see.
 */

/** What a project is called until somebody renames it. */
export const DEFAULT_PROJECT_NAME = 'Untitled project';

/**
 * The longest name a project may have.
 *
 * Long enough for any title a person actually types, short enough that the
 * list and the header can show it without the layout deciding for them.
 */
export const PROJECT_NAME_MAX_CHARS = 120;

/**
 * Turns one transcript may hold.
 *
 * Far past anything a real conversation reaches (each turn is a person
 * typing a message and waiting for an answer), and there so that a client
 * with a bug in its autosave cannot grow one object without bound.
 */
export const MAX_TRANSCRIPT_TURNS = 2_000;

/**
 * The most text any one field of a turn may carry.
 *
 * The prompt a person typed is bounded well below this by the chat and
 * build routes; a model's summary of what it built and a failure's first
 * problem are not bounded anywhere else, which is why the figure is
 * generous. The builder clips to it before saving (`clipTranscriptTurn`),
 * so a long summary costs its tail rather than the save.
 */
export const MAX_TRANSCRIPT_FIELD_CHARS = 20_000;

/**
 * The most a serialised transcript may weigh, in bytes of JSON.
 *
 * The transcript lives in R2 rather than in its D1 row for exactly this
 * reason: a long conversation is hundreds of kilobytes, and D1 is the
 * wrong place for a value that size. The bound is what keeps "can be large"
 * from being "can be anything".
 */
export const MAX_TRANSCRIPT_BYTES = 2 * 1024 * 1024;

export const TRANSCRIPT_STATUSES = [
  'running',
  'accepted',
  'failed',
  'cancelled',
  'replied',
] as const;

export type TranscriptStatus = (typeof TRANSCRIPT_STATUSES)[number];

/** One prompt and what became of it. */
export interface TranscriptTurn {
  id: number;
  runId: string;
  prompt: string;
  at: number;
  /**
   * `replied`: the agent answered in words and nothing was built (the
   * decision recorded in docs/decisions.md, 2026-09-28).
   */
  status: TranscriptStatus;
  /**
   * What the agent said in the conversation: the whole reply for a
   * `replied` turn, or its one line about the change it is making for a
   * build. Null for a turn that went straight to a build.
   */
  agentMessage?: string | null;
  /** The model's own description of what it built. Null until the plan lands. */
  summary: string | null;
  fileCount: number;
  revision: string | null;
  /** The first problem, when the run failed. Cancellation is not a problem. */
  problem: string | null;
  providerId: string | null;
}

export type TranscriptParse =
  { ok: true; turns: TranscriptTurn[] } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is TranscriptStatus {
  return (
    typeof value === 'string' &&
    (TRANSCRIPT_STATUSES as readonly string[]).includes(value)
  );
}

function boundedText(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MAX_TRANSCRIPT_FIELD_CHARS
  );
}

function optionalText(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || boundedText(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Read a transcript as the builder sent it, or say why it cannot be kept.
 *
 * Refused rather than filtered, the rule the generation request follows
 * too: the only thing that writes one is this product's own builder, so a
 * malformed turn is a bug worth hearing about, and quietly dropping it
 * would lose part of somebody's conversation the next time they opened the
 * project. What is kept is rebuilt field by field, so nothing the caller
 * added beyond the shape above is ever stored.
 */
export function parseTranscript(value: unknown): TranscriptParse {
  if (!Array.isArray(value)) {
    return { ok: false, error: '"transcript" must be a list of turns.' };
  }
  if (value.length > MAX_TRANSCRIPT_TURNS) {
    return {
      ok: false,
      error: `A transcript may hold at most ${MAX_TRANSCRIPT_TURNS} turns.`,
    };
  }
  const turns: TranscriptTurn[] = [];
  for (const [index, raw] of value.entries()) {
    const where = `Transcript turn ${index + 1}`;
    if (!isRecord(raw)) return { ok: false, error: `${where} is not a turn.` };
    const {
      id,
      runId,
      prompt,
      at,
      status,
      agentMessage,
      summary,
      fileCount,
      revision,
      problem,
      providerId,
    } = raw;
    if (!finiteNumber(id) || !finiteNumber(at) || !finiteNumber(fileCount)) {
      return { ok: false, error: `${where} has a malformed number.` };
    }
    if (!isStatus(status)) {
      return { ok: false, error: `${where} has an unknown status.` };
    }
    if (!boundedText(runId) || !boundedText(prompt)) {
      return {
        ok: false,
        error: `${where} is missing its text or is too long.`,
      };
    }
    if (
      !optionalText(agentMessage) ||
      !optionalText(summary) ||
      !optionalText(revision) ||
      !optionalText(problem) ||
      !optionalText(providerId)
    ) {
      return { ok: false, error: `${where} has a field that is too long.` };
    }
    turns.push({
      id,
      runId,
      prompt,
      at,
      status,
      agentMessage: agentMessage ?? null,
      summary: summary ?? null,
      fileCount,
      revision: revision ?? null,
      problem: problem ?? null,
      providerId: providerId ?? null,
    });
  }
  return { ok: true, turns };
}

function clip(text: string): string {
  return text.length > MAX_TRANSCRIPT_FIELD_CHARS
    ? text.slice(0, MAX_TRANSCRIPT_FIELD_CHARS)
    : text;
}

function clipOptional(text: string | null | undefined): string | null {
  return text === undefined || text === null ? null : clip(text);
}

/**
 * A turn cut to what `parseTranscript` accepts, for the builder to save.
 *
 * Only ever shortens. A model's summary longer than the bound loses its
 * tail, which is a smaller loss than an autosave that is refused every time
 * until the project is closed.
 */
export function clipTranscriptTurn(turn: TranscriptTurn): TranscriptTurn {
  return {
    id: turn.id,
    runId: clip(turn.runId),
    prompt: clip(turn.prompt),
    at: turn.at,
    status: turn.status,
    agentMessage: clipOptional(turn.agentMessage),
    summary: clipOptional(turn.summary),
    fileCount: turn.fileCount,
    revision: clipOptional(turn.revision),
    problem: clipOptional(turn.problem),
    providerId: clipOptional(turn.providerId),
  };
}

/**
 * A transcript as it should read after the page that wrote it is gone.
 *
 * A turn saved while still `running` belonged to a request that the reload
 * or the switch to another project dropped, and a dropped request is one the
 * Worker stops (`handlePlan` terminates the run when its caller leaves, and
 * a chat turn is aborted the same way). Showing it as still running would
 * leave a spinner nothing will ever resolve, so it reads as cancelled,
 * which is what happened to it.
 */
export function settledTranscript(turns: TranscriptTurn[]): TranscriptTurn[] {
  return turns.map((turn) =>
    turn.status === 'running' ? { ...turn, status: 'cancelled' } : turn,
  );
}

/**
 * A project name as a person typed it, or `null` when there is nothing
 * there worth keeping.
 *
 * Trimmed, with every run of whitespace (a pasted newline included) made
 * one space, and cut to the bound. A name is shown on one line in two
 * places, so it is kept as something that fits on one.
 */
export function cleanProjectName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Control characters go before whitespace is collapsed, so a pasted tab
  // or line break becomes a space rather than vanishing between two words.
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PROJECT_NAME_MAX_CHARS)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** What a duplicate is called: the original's name, marked as a copy. */
export function copyName(name: string): string {
  const suffix = ' (copy)';
  const room = PROJECT_NAME_MAX_CHARS - suffix.length;
  return `${name.length > room ? name.slice(0, room).trimEnd() : name}${suffix}`;
}

/**
 * What a remix is called: somebody else's shared project, copied into the
 * caller's account. Named for where it came from rather than as a copy,
 * because in the remixer's list there is no original beside it for "(copy)"
 * to be a copy of.
 */
export function remixName(name: string): string {
  const prefix = 'Remix of ';
  const room = PROJECT_NAME_MAX_CHARS - prefix.length;
  return `${prefix}${name.length > room ? name.slice(0, room).trimEnd() : name}`;
}
