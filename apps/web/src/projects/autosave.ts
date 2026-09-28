import type { ProjectPatch } from './projects-client.ts';

/**
 * Saving a project as it changes, without anybody pressing Save.
 *
 * Debounced, because the things that trigger a save arrive in bursts: a
 * build closes its turn and moves the accepted revision in the same moment,
 * and somebody picking a model and then a style is two changes a second
 * apart that belong in one request. Changes that arrive while a save is in
 * flight wait for it and go in the next one, so two saves of one project
 * are never in the air at once and the later one always lands last.
 *
 * It never blocks anything. `schedule` returns at once, and the only thing
 * the builder sees is `status`, which it shows as one quiet word.
 *
 * A failed save is not dropped. What it carried is folded back under
 * anything newer and tried again, after a pause, so a network blip costs a
 * few seconds rather than the change. A save the Worker refuses because the
 * project is gone is the one that is not retried: nothing sent again will
 * bring it back.
 *
 * Framework-free, like `BuilderSession`, so every rule here is tested
 * without a DOM or a clock.
 */

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** What one attempt came to. */
export type SaveOutcome = 'saved' | 'retry' | 'gone';

export interface AutosaveOptions {
  /** Quiet time before a burst of changes is sent. */
  delayMs?: number;
  /** Pause before a failed save is tried again. */
  retryMs?: number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Two patches as one, the later winning field by field. Settings are
 * merged a level deeper, so a model chosen and then a style chosen are
 * both kept rather than the second replacing the first.
 */
export function mergePatches(
  earlier: ProjectPatch | null,
  later: ProjectPatch | null,
): ProjectPatch | null {
  if (!earlier) return later;
  if (!later) return earlier;
  const merged: ProjectPatch = { ...earlier, ...later };
  if (earlier.settings || later.settings) {
    merged.settings = { ...earlier.settings, ...later.settings };
  }
  return merged;
}

export class Autosaver {
  readonly #save: (patch: ProjectPatch) => Promise<SaveOutcome>;
  readonly #delayMs: number;
  readonly #retryMs: number;
  readonly #setTimer: (run: () => void, ms: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;
  #pending: ProjectPatch | null = null;
  #timer: unknown = null;
  #chain: Promise<void> = Promise.resolve();
  #status: SaveStatus = 'idle';
  #listeners = new Set<() => void>();
  #disposed = false;

  constructor(
    save: (patch: ProjectPatch) => Promise<SaveOutcome>,
    options: AutosaveOptions = {},
  ) {
    this.#save = save;
    this.#delayMs = options.delayMs ?? 1_000;
    this.#retryMs = options.retryMs ?? 10_000;
    this.#setTimer =
      options.setTimer ?? ((run, ms) => globalThis.setTimeout(run, ms));
    this.#clearTimer =
      options.clearTimer ??
      ((handle) =>
        globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get status(): SaveStatus {
    return this.#status;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Queue a change. Sent once things have been quiet for `delayMs`. */
  schedule(patch: ProjectPatch): void {
    if (this.#disposed) return;
    this.#pending = mergePatches(this.#pending, patch);
    this.#arm(this.#delayMs);
  }

  /**
   * Send whatever is queued now, and resolve once it and anything already
   * in flight have finished. What the builder awaits before it leaves a
   * project, so the last change is not lost on the way out.
   */
  flush(): Promise<void> {
    this.#disarm();
    this.#chain = this.#chain.then(() => this.#drain());
    return this.#chain;
  }

  /** Stop. Anything still queued is dropped: flush first to keep it. */
  dispose(): void {
    this.#disposed = true;
    this.#disarm();
    this.#pending = null;
    this.#listeners.clear();
  }

  async #drain(): Promise<void> {
    while (this.#pending && !this.#disposed) {
      const patch = this.#pending;
      this.#pending = null;
      this.#setStatus('saving');
      let outcome: SaveOutcome;
      try {
        outcome = await this.#save(patch);
      } catch {
        outcome = 'retry';
      }
      if (this.#disposed) return;
      if (outcome === 'saved') {
        if (!this.#pending) this.#setStatus('saved');
        continue;
      }
      this.#setStatus('error');
      if (outcome === 'retry') {
        // Under anything newer, so a retry never undoes a later change.
        this.#pending = mergePatches(patch, this.#pending);
        this.#arm(this.#retryMs);
      }
      return;
    }
  }

  #arm(ms: number): void {
    this.#disarm();
    this.#timer = this.#setTimer(() => {
      this.#timer = null;
      void this.flush();
    }, ms);
  }

  #disarm(): void {
    if (this.#timer !== null) {
      this.#clearTimer(this.#timer);
      this.#timer = null;
    }
  }

  #setStatus(status: SaveStatus): void {
    if (status === this.#status) return;
    this.#status = status;
    for (const listener of this.#listeners) listener();
  }
}
