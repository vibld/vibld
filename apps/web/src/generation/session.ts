import {
  BudgetExceededError,
  DurableGenerationRunner,
  FakeModelProvider,
  InMemoryGenerationStore,
  RunBudgetLedger,
} from '@vibld/core';
import type {
  GenerationState,
  ProjectFile,
  ProjectSnapshot,
  RunUsageReport,
} from '@vibld/core';
import type { ProjectBrief } from './brief.ts';
import { deriveBrief } from './brief.ts';
import type { PlanMode } from './plan-builder.ts';
import { buildPlan } from './plan-builder.ts';
import { createValidator } from './validator.ts';
import {
  ObservingGenerationStore,
  ObservingModelProvider,
  withValidationDelay,
} from './observers.ts';

export type BuilderStatus =
  'idle' | 'planning' | 'staging' | 'validating' | 'accepted' | 'failed';

export interface TimelineEntry {
  id: number;
  at: number;
  level: 'info' | 'error';
  message: string;
}

export interface BuilderState {
  status: BuilderStatus;
  running: boolean;
  runId: string | null;
  prompt: string | null;
  planSummary: string | null;
  stagedFiles: ProjectFile[];
  acceptedSnapshot: ProjectSnapshot | null;
  acceptedBrief: ProjectBrief | null;
  problems: string[];
  timeline: TimelineEntry[];
  runCount: number;
  budget: RunUsageReport;
}

export interface SessionOptions {
  /** Pause between lifecycle stages. Tests pass a no-op for determinism. */
  delay?: (ms: number) => Promise<void>;
  /** Injected so timeline entries are deterministic under test. */
  now?: () => number;
  stageDelayMs?: number;
  projectId?: string;
  budget?: ConstructorParameters<typeof RunBudgetLedger>[0];
}

const DEFAULT_BUDGET = {
  modelInputTokens: 50_000,
  modelOutputTokens: 200_000,
  toolCalls: 100,
};

/** Rough, deterministic token estimate. No tokenizer is involved. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

const RESERVED_OUTPUT_TOKENS = 32_000;

function initialState(budget: RunUsageReport): BuilderState {
  return {
    status: 'idle',
    running: false,
    runId: null,
    prompt: null,
    planSummary: null,
    stagedFiles: [],
    acceptedSnapshot: null,
    acceptedBrief: null,
    problems: [],
    timeline: [],
    runCount: 0,
    budget,
  };
}

const STATUS_FROM_STAGE: Partial<Record<GenerationState, BuilderStatus>> = {
  planning: 'planning',
  staging: 'staging',
  validating: 'validating',
  accepted: 'accepted',
  failed: 'failed',
};

/**
 * Framework-free controller for the builder shell.
 *
 * React binds to it through `useSyncExternalStore`, which keeps every
 * ordering rule in one testable place: a reset or a new submission
 * invalidates the in-flight run (`#epoch`), and a disposed session drops
 * every pending write, so no result from an abandoned run can land in the UI.
 */
export class BuilderSession {
  #state: BuilderState;
  #listeners = new Set<() => void>();
  #store = new InMemoryGenerationStore();
  #ledger: RunBudgetLedger;
  #epoch = 0;
  #runSeq = 0;
  #entrySeq = 0;
  #disposed = false;
  readonly #projectId: string;
  readonly #delay: (ms: number) => Promise<void>;
  readonly #now: () => number;
  readonly #stageDelayMs: number;
  readonly #budgetLimits: ConstructorParameters<typeof RunBudgetLedger>[0];

  constructor(options: SessionOptions = {}) {
    this.#delay =
      options.delay ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.#now = options.now ?? (() => Date.now());
    this.#stageDelayMs = options.stageDelayMs ?? 420;
    this.#projectId = options.projectId ?? 'local-project';
    this.#budgetLimits = options.budget ?? DEFAULT_BUDGET;
    this.#ledger = new RunBudgetLedger(this.#budgetLimits);
    this.#state = initialState(this.#ledger.report());
  }

  getState = (): BuilderState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  dispose(): void {
    this.#disposed = true;
    this.#epoch += 1;
    this.#listeners.clear();
  }

  /** Discard the whole session: accepted checkpoint, history and budget. */
  reset(): void {
    if (this.#disposed) return;
    this.#epoch += 1;
    this.#store = new InMemoryGenerationStore();
    this.#ledger = new RunBudgetLedger(this.#budgetLimits);
    this.#entrySeq = 0;
    this.#state = initialState(this.#ledger.report());
    this.#emit();
  }

  async submit(prompt: string, mode: PlanMode = 'succeed'): Promise<void> {
    const trimmed = prompt.trim();
    if (this.#disposed || this.#state.running || trimmed.length === 0) return;

    const epoch = this.#epoch;
    this.#runSeq += 1;
    const runId = `run-${this.#runSeq}`;
    const brief = deriveBrief(trimmed);
    const plan = buildPlan(trimmed, mode);

    const inputTokens = estimateTokens(trimmed);
    let reservation;
    try {
      reservation = this.#ledger.reserve({
        modelInputTokens: inputTokens,
        modelOutputTokens: RESERVED_OUTPUT_TOKENS,
        toolCalls: 1,
      });
    } catch (error) {
      const message =
        error instanceof BudgetExceededError
          ? `Run budget exceeded for ${error.resource}: ${error.requested} requested, ${error.remaining} remaining`
          : error instanceof Error
            ? error.message
            : String(error);
      this.#patch(epoch, (state) => ({
        ...state,
        status: 'failed',
        runId,
        prompt: trimmed,
        problems: [message],
        timeline: this.#append(state.timeline, 'error', message),
      }));
      return;
    }

    this.#patch(epoch, (state) => ({
      ...state,
      status: 'planning',
      running: true,
      runId,
      prompt: trimmed,
      planSummary: null,
      stagedFiles: [],
      problems: [],
      timeline: this.#append(
        state.timeline,
        'info',
        `Run ${runId} started: "${trimmed}"`,
      ),
    }));

    const pause = () => this.#delay(this.#stageDelayMs);
    const observer = {
      onStage: (record: { runId: string; state: GenerationState }) => {
        const status = STATUS_FROM_STAGE[record.state];
        if (!status || status === 'accepted' || status === 'failed') return;
        this.#patch(epoch, (state) => ({
          ...state,
          status,
          timeline: this.#append(
            state.timeline,
            'info',
            `${record.runId}: ${record.state}`,
          ),
        }));
      },
      onPromotion: () => {},
      onPlan: (generated: { summary: string; files: ProjectFile[] }) => {
        this.#patch(epoch, (state) => ({
          ...state,
          status: 'staging',
          planSummary: generated.summary,
          stagedFiles: generated.files.map((file) => ({ ...file })),
          timeline: this.#append(
            state.timeline,
            'info',
            `Plan ready: ${generated.files.length} files staged`,
          ),
        }));
      },
    };

    const store = new ObservingGenerationStore(this.#store, observer);
    const provider = new ObservingModelProvider(
      new FakeModelProvider([plan]),
      observer,
      pause,
    );
    const validator = withValidationDelay(createValidator(), pause);
    const runner = new DurableGenerationRunner(store);

    let result;
    try {
      result = await runner.run(
        { prompt: trimmed, projectId: this.#projectId, runId },
        provider,
        validator,
      );
    } catch (error) {
      reservation.release();
      const message = error instanceof Error ? error.message : String(error);
      this.#patch(epoch, (state) => ({
        ...state,
        status: 'failed',
        running: false,
        problems: [message],
        timeline: this.#append(state.timeline, 'error', message),
      }));
      return;
    }

    const outputTokens = Math.min(
      RESERVED_OUTPUT_TOKENS,
      estimateTokens(plan.files.map((file) => file.content).join('')),
    );
    reservation.commit({
      modelInputTokens: inputTokens,
      modelOutputTokens: outputTokens,
      toolCalls: 1,
    });
    const budget = this.#ledger.report();

    if (result.state === 'accepted' && result.accepted) {
      const accepted = result.accepted;
      this.#patch(epoch, (state) => ({
        ...state,
        status: 'accepted',
        running: false,
        acceptedSnapshot: accepted,
        acceptedBrief: brief,
        stagedFiles: accepted.files.map((file) => ({ ...file })),
        problems: [],
        runCount: state.runCount + 1,
        budget,
        timeline: this.#append(
          state.timeline,
          'info',
          `Checkpoint accepted at revision ${accepted.revision}`,
        ),
      }));
      return;
    }

    const problems =
      result.errors.length > 0
        ? result.errors
        : ['Generation did not produce an accepted checkpoint'];
    this.#patch(epoch, (state) => ({
      ...state,
      status: 'failed',
      running: false,
      problems,
      runCount: state.runCount + 1,
      budget,
      timeline: problems.reduce(
        (timeline, problem) => this.#append(timeline, 'error', problem),
        this.#append(
          state.timeline,
          'error',
          `Run ${runId} failed; the previous accepted checkpoint is unchanged`,
        ),
      ),
    }));
  }

  #append(
    timeline: TimelineEntry[],
    level: TimelineEntry['level'],
    message: string,
  ): TimelineEntry[] {
    this.#entrySeq += 1;
    return [
      ...timeline,
      { id: this.#entrySeq, at: this.#now(), level, message },
    ];
  }

  /**
   * Apply a state update only if it belongs to the current epoch. A run
   * abandoned by `reset()` or `dispose()` cannot overwrite newer state.
   */
  #patch(epoch: number, update: (state: BuilderState) => BuilderState): void {
    if (this.#disposed || epoch !== this.#epoch) return;
    this.#state = update(this.#state);
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
