import {
  BudgetExceededError,
  DurableGenerationRunner,
  FakeModelProvider,
  InMemoryGenerationStore,
  RunBudgetLedger,
} from '@vibld/core';
import type {
  GenerationPlan,
  GenerationState,
  ProjectFile,
  ProjectSnapshot,
  RunUsageReport,
} from '@vibld/core';
import type { ModelProvider } from '@vibld/core';
import type { StylePresetId } from '@vibld/ai/style-presets';
import { MAX_REFERENCE_CHARS } from '@vibld/ai/limits';
import type { ModelOption } from './remote-provider.ts';
import type { ProjectBrief } from './brief.ts';
import { deriveBrief } from './brief.ts';
import type { PlanMode } from './plan-builder.ts';
import { buildPlan } from './plan-builder.ts';
import type { StyleDna } from '@vibld/ai/style-dna';
import { createValidator } from './validator.ts';
import {
  ObservingGenerationStore,
  ObservingModelProvider,
  withValidationDelay,
} from './observers.ts';
import {
  RemoteModelProvider,
  detectGenerationMode,
} from './remote-provider.ts';

export type BuilderStatus =
  | 'idle'
  | 'planning'
  | 'staging'
  | 'validating'
  | 'accepted'
  | 'failed'
  | 'cancelled';

export interface TimelineEntry {
  id: number;
  at: number;
  level: 'info' | 'warn' | 'error';
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
  /** Which provider produced the last plan, so the UI never implies AI. */
  providerId: string | null;
  /**
   * How far the in-flight generation has got. Null when nothing is running.
   *
   * A real project takes minutes to write. Without this the shell shows the
   * same frozen "Generating..." for the whole wait, which reads as a hang --
   * and did, for two days.
   */
  progress: GenerationProgress | null;
  /**
   * The conversation so far, oldest first.
   *
   * Building an application is a conversation, not a single request: the
   * second prompt is where the value is. The run history used to survive
   * only as flat log lines in a tab nobody opened, so each run visually
   * replaced the last and the shell read as one-shot even though the engine
   * has always iterated.
   */
  transcript: TranscriptTurn[];
  /**
   * Standing instructions for this project, applied to every turn.
   *
   * They exist so nobody has to retype "keep it dark, no rounded corners" on
   * every prompt. Kept out of the transcript deliberately: they are not
   * something that was said once, they are a condition on everything said.
   */
  knowledge: string;
  styleDna: StyleDna;
  /** The chosen model id, or null for the deployment's default. */
  model: string | null;
  /** What this deployment can serve. Empty until the probe answers. */
  models: ModelOption[];
  /**
   * Whether the signed-in caller is a platform admin (docs/decisions.md
   * L4) -- decides only whether `AdminPanel` renders. `false` until the
   * `/api/config` probe answers, the same as `models` above.
   */
  isAdmin: boolean;
}

/** One prompt and what became of it. */
export interface TranscriptTurn {
  id: number;
  runId: string;
  prompt: string;
  at: number;
  status: 'running' | 'accepted' | 'failed' | 'cancelled';
  /** The model's own description of what it built. Null until the plan lands. */
  summary: string | null;
  fileCount: number;
  revision: string | null;
  /** The first problem, when the run failed. Cancellation is not a problem. */
  problem: string | null;
  providerId: string | null;
}

export interface GenerationProgress {
  characters: number;
  elapsedMs: number;
}

export interface SessionOptions {
  /** Pause between lifecycle stages. Tests pass a no-op for determinism. */
  delay?: (ms: number) => Promise<void>;
  /** Injected so timeline entries are deterministic under test. */
  now?: () => number;
  stageDelayMs?: number;
  projectId?: string;
  budget?: ConstructorParameters<typeof RunBudgetLedger>[0];
  /**
   * Resolve the provider for a run. Defaults to asking the deployment: the
   * hosted Worker when it is configured, the deterministic fake otherwise.
   */
  resolveProvider?: (
    plan: GenerationPlan,
    signal: AbortSignal,
    onProgress?: (progress: GenerationProgress) => void,
    style?: StylePresetId | null,
    knowledge?: string | null,
    model?: string | null,
    referenceUrl?: string | null,
    styleDna?: StyleDna | null,
  ) => Promise<ModelProvider>;
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

/** The same estimate for a length already counted. Zero stays zero. */
function estimateTokensForChars(chars: number): number {
  return chars > 0 ? Math.ceil(chars / 4) : 0;
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
    providerId: null,
    progress: null,
    transcript: [],
    knowledge: '',
    styleDna: {},
    model: null,
    models: [],
    isAdmin: false,
  };
}

/**
 * Ask the deployment which provider to use. A hosted Worker with credentials
 * and Access configured serves real generation; anything else -- local dev,
 * the static-only deploy -- gets the deterministic fake. The shell never
 * carries a provider credential itself (ADR-0006).
 */
async function defaultResolveProvider(
  plan: GenerationPlan,
  signal: AbortSignal,
  onProgress?: (progress: GenerationProgress) => void,
  style?: StylePresetId | null,
  knowledge?: string | null,
  model?: string | null,
  referenceUrl?: string | null,
  styleDna?: StyleDna | null,
): Promise<ModelProvider> {
  const mode = await detectGenerationMode();
  return mode === 'model'
    ? new RemoteModelProvider({
        signal,
        ...(onProgress ? { onProgress } : {}),
        ...(style ? { style } : {}),
        ...(knowledge ? { knowledge } : {}),
        ...(model ? { model } : {}),
        ...(referenceUrl ? { referenceUrl } : {}),
        ...(styleDna && Object.keys(styleDna).length > 0 ? { styleDna } : {}),
      })
    : // The deterministic fake has no visual vocabulary at all, so a preset
      // cannot change what it produces. Nothing here pretends otherwise.
      new FakeModelProvider([plan]);
}

function isFakeProvider(provider: ModelProvider): boolean {
  return provider.id === 'fake';
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
  #turnSeq = 0;
  #disposed = false;
  readonly #projectId: string;
  readonly #delay: (ms: number) => Promise<void>;
  readonly #now: () => number;
  readonly #stageDelayMs: number;
  readonly #budgetLimits: ConstructorParameters<typeof RunBudgetLedger>[0];
  readonly #resolveProvider: (
    plan: GenerationPlan,
    signal: AbortSignal,
    onProgress?: (progress: GenerationProgress) => void,
    style?: StylePresetId | null,
    knowledge?: string | null,
    model?: string | null,
    referenceUrl?: string | null,
    styleDna?: StyleDna | null,
  ) => Promise<ModelProvider>;
  #abort: AbortController | null = null;

  constructor(options: SessionOptions = {}) {
    this.#delay =
      options.delay ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.#now = options.now ?? (() => Date.now());
    this.#stageDelayMs = options.stageDelayMs ?? 420;
    this.#projectId = options.projectId ?? 'local-project';
    this.#budgetLimits = options.budget ?? DEFAULT_BUDGET;
    this.#ledger = new RunBudgetLedger(this.#budgetLimits);
    this.#resolveProvider = options.resolveProvider ?? defaultResolveProvider;
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

  /** Choose the model, or null for the deployment's default. */
  setModel(model: string | null): void {
    if (this.#disposed || model === this.#state.model) return;
    this.#state = { ...this.#state, model };
    this.#emit();
  }

  /** Record what the deployment can serve, once the probe answers. */
  setModels(models: ModelOption[]): void {
    if (this.#disposed) return;
    this.#state = { ...this.#state, models };
    this.#emit();
  }

  /** Record whether the signed-in caller is a platform admin, once the probe answers. */
  setIsAdmin(isAdmin: boolean): void {
    if (this.#disposed || isAdmin === this.#state.isAdmin) return;
    this.#state = { ...this.#state, isAdmin };
    this.#emit();
  }

  /**
   * Replace the project's standing visual preferences.
   *
   * Stored as the selection, not as prose: the same choice produces the same
   * guidance every turn, which is the whole reason this is not more text in
   * the knowledge field.
   */
  setStyleDna(styleDna: StyleDna): void {
    if (this.#disposed) return;
    this.#state = { ...this.#state, styleDna };
    this.#emit();
  }

  /** Replace the project's standing instructions. */
  setKnowledge(knowledge: string): void {
    if (this.#disposed || knowledge === this.#state.knowledge) return;
    this.#state = { ...this.#state, knowledge };
    this.#emit();
  }

  /**
   * Discard the whole session: accepted checkpoint, history and budget.
   *
   * Preferences survive it, and so does what the deployment can serve.
   * Standing instructions and the chosen model are how someone wants things
   * built rather than part of the thing that was built, and the model list
   * came from a probe that only runs once a page load -- clearing it would
   * make the picker disappear after "Start over" until a reload.
   */
  reset(): void {
    if (this.#disposed) return;
    const { knowledge, model, models, isAdmin } = this.#state;
    this.#epoch += 1;
    this.#store = new InMemoryGenerationStore();
    this.#ledger = new RunBudgetLedger(this.#budgetLimits);
    this.#entrySeq = 0;
    this.#turnSeq = 0;
    this.#state = {
      ...initialState(this.#ledger.report()),
      knowledge,
      model,
      models,
      isAdmin,
    };
    this.#emit();
  }

  async submit(
    prompt: string,
    mode: PlanMode = 'succeed',
    style: StylePresetId | null = null,
    referenceUrl: string | null = null,
  ): Promise<void> {
    const trimmed = prompt.trim();
    if (this.#disposed || this.#state.running || trimmed.length === 0) return;

    const epoch = this.#epoch;
    this.#runSeq += 1;
    const runId = `run-${this.#runSeq}`;
    const brief = deriveBrief(trimmed);
    const plan = buildPlan(trimmed, mode);

    // The accepted project is sent with the request, so it is part of what
    // this run spends. Counting the typed prompt alone made every follow-up
    // look as cheap as the first request.
    const baseChars = (this.#state.acceptedSnapshot?.files ?? []).reduce(
      (sum, file) => sum + file.path.length + file.content.length,
      0,
    );
    // A reference URL's actual content is not known until the Worker fetches
    // it, so this counts the worst case (`MAX_REFERENCE_CHARS`) rather than
    // zero -- the same reasoning as `baseChars`: an estimate that ignores a
    // real cost is not an estimate a budget can be checked against.
    const inputTokens =
      estimateTokens(trimmed) +
      estimateTokensForChars(baseChars) +
      estimateTokensForChars(this.#state.knowledge.length) +
      (referenceUrl ? estimateTokensForChars(MAX_REFERENCE_CHARS) : 0);
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
        transcript: this.#openTurn(state.transcript, runId, trimmed, {
          status: 'failed',
          problem: message,
        }),
        timeline: this.#append(state.timeline, 'error', message),
      }));
      return;
    }

    const controller = new AbortController();
    this.#abort = controller;

    this.#patch(epoch, (state) => ({
      ...state,
      status: 'planning',
      running: true,
      runId,
      prompt: trimmed,
      planSummary: null,
      stagedFiles: [],
      problems: [],
      transcript: this.#openTurn(state.transcript, runId, trimmed),
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
          transcript: this.#closeTurn(state.transcript, {
            summary: generated.summary,
            fileCount: generated.files.length,
          }),
          timeline: this.#append(
            state.timeline,
            'info',
            `Plan ready: ${generated.files.length} files staged`,
          ),
        }));
      },
    };

    const store = new ObservingGenerationStore(this.#store, observer);

    let resolved: ModelProvider;
    try {
      resolved = await this.#resolveProvider(
        plan,
        controller.signal,
        (progress) => {
          this.#patch(epoch, (state) => ({ ...state, progress }));
        },
        style,
        this.#state.knowledge,
        this.#state.model,
        referenceUrl,
        this.#state.styleDna,
      );
    } catch (error) {
      reservation.release();
      const message = error instanceof Error ? error.message : String(error);
      this.#patch(epoch, (state) => ({
        ...state,
        status: 'failed',
        running: false,
        progress: null,
        problems: [message],
        transcript: this.#closeTurn(state.transcript, {
          status: 'failed',
          problem: message,
        }),
        timeline: this.#append(state.timeline, 'error', message),
      }));
      return;
    }

    const provider = new ObservingModelProvider(resolved, observer, pause);
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
        progress: null,
        problems: [message],
        transcript: this.#closeTurn(state.transcript, {
          status: 'failed',
          problem: message,
        }),
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
        progress: null,
        acceptedSnapshot: accepted,
        // The mock preview is rendered from this brief. It only describes the
        // deterministic fake's own output, so a model-generated project must
        // not reuse it -- that would show a preview of files nobody generated.
        acceptedBrief: isFakeProvider(resolved) ? brief : null,
        providerId: resolved.id,
        stagedFiles: accepted.files.map((file) => ({ ...file })),
        problems: [],
        runCount: state.runCount + 1,
        budget,
        transcript: this.#closeTurn(state.transcript, {
          status: 'accepted',
          summary: state.planSummary,
          fileCount: accepted.files.length,
          revision: accepted.revision,
          providerId: resolved.id,
        }),
        // Warnings belong on the accepted path, which is the point of them:
        // the project works and still has something worth looking at. They
        // follow the acceptance line so the run reads as a success first.
        timeline: (result.warnings ?? []).reduce(
          (timeline, warning) => this.#append(timeline, 'warn', warning),
          this.#append(
            state.timeline,
            'info',
            `Checkpoint accepted at revision ${accepted.revision}`,
          ),
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
      progress: null,
      problems,
      runCount: state.runCount + 1,
      budget,
      providerId: resolved.id,
      transcript: this.#closeTurn(state.transcript, {
        status: 'failed',
        problem: problems[0] ?? null,
        providerId: resolved.id,
      }),
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

  /**
   * Stop the active run and keep the accepted checkpoint.
   *
   * Aborting the request drops the connection, and the endpoint treats that
   * as its signal to abort its own model call -- so this stops the spending,
   * not merely the waiting.
   *
   * The abandoned run still settles its budget reservation at the full
   * estimate. That over-charges a run cut short, which is the safe direction
   * for a ceiling; the figure in the footer catches up on the next run, since
   * the epoch bump below drops every later write from the run being left.
   */
  cancel(): void {
    if (this.#disposed || !this.#state.running) return;

    this.#abort?.abort();
    this.#abort = null;
    this.#epoch += 1;

    this.#state = {
      ...this.#state,
      status: 'cancelled',
      running: false,
      progress: null,
      problems: [],
      transcript: this.#closeTurn(this.#state.transcript, {
        status: 'cancelled',
      }),
      timeline: this.#append(
        this.#state.timeline,
        'info',
        `Run ${this.#state.runId ?? ''} cancelled; the accepted checkpoint is unchanged`.trim(),
      ),
    };
    this.#emit();
  }

  /** Start a turn. Its outcome is filled in later by `#closeTurn`. */
  #openTurn(
    transcript: TranscriptTurn[],
    runId: string,
    prompt: string,
    patch: Partial<TranscriptTurn> = {},
  ): TranscriptTurn[] {
    this.#turnSeq += 1;
    return [
      ...transcript,
      {
        id: this.#turnSeq,
        runId,
        prompt,
        at: this.#now(),
        status: 'running',
        summary: null,
        fileCount: 0,
        revision: null,
        problem: null,
        providerId: null,
        ...patch,
      },
    ];
  }

  /**
   * Update the turn still in flight.
   *
   * Only a running turn is touched. `cancel()` closes a turn and then bumps
   * the epoch, but the abandoned run is still unwinding: without this guard a
   * late failure from it would rewrite a cancellation as an error the user
   * has to read.
   */
  #closeTurn(
    transcript: TranscriptTurn[],
    patch: Partial<TranscriptTurn>,
  ): TranscriptTurn[] {
    const last = transcript.at(-1);
    if (!last || last.status !== 'running') return transcript;
    return [...transcript.slice(0, -1), { ...last, ...patch }];
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
