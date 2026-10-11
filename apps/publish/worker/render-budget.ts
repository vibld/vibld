/**
 * The renders every site may start together in a minute (D204), counted
 * in one place.
 *
 * A Workers rate limit counts in each Cloudflare location on its own, so a
 * spoofed bot User-Agent sent through many locations would get a limit's
 * worth of billed browser time in every one of them. Durable Objects are
 * the platform's one place that sees every location's callers: this is a
 * single object (`idFromName(RENDER_BUDGET_NAME)`), asked only on a render
 * that is not cached and that the site's own limit already let through, so
 * it sees a few calls a minute, far below what one object serves.
 *
 * A fixed one-minute window, kept in the object's storage so an object
 * evicted or restarted mid-minute (a deploy) picks up the count it had.
 * The storage calls are synchronous and nothing awaits between the read
 * and the write in `take`, so concurrent callers cannot both take the last
 * render.
 *
 * A plain class with a `fetch` handler rather than `DurableObject` from
 * `cloudflare:workers`, so `node --test` can load it like the rest.
 */
export const RENDER_BUDGET_PER_MINUTE = 30;

/** The one object every render is counted by. */
export const RENDER_BUDGET_NAME = 'renders';

/** The slice of the object's storage used here (`ctx.storage.kv`). */
export interface BudgetStorage {
  get<T>(key: string): T | undefined;
  put<T>(key: string, value: T): void;
}

interface Window {
  minute: number;
  started: number;
}

export class RenderBudget {
  private readonly kv: BudgetStorage;
  private readonly now: () => number;

  /** `now` is for tests; the runtime passes only the first two. */
  constructor(
    state: { storage: { kv: BudgetStorage } },
    _env: unknown,
    now: () => number = Date.now,
  ) {
    this.kv = state.storage.kv;
    this.now = now;
  }

  /** `yes` when a render may start, `no` when the minute's are used. */
  async fetch(): Promise<Response> {
    return new Response(this.take(this.now()) ? 'yes' : 'no');
  }

  take(now: number): boolean {
    const minute = Math.floor(now / 60_000);
    const kept = this.kv.get<Window>('window');
    const started = kept?.minute === minute ? kept.started : 0;
    if (started >= RENDER_BUDGET_PER_MINUTE) return false;
    this.kv.put<Window>('window', { minute, started: started + 1 });
    return true;
  }
}
