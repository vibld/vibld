import {
  BudgetExceededError,
  DurableGenerationRunner,
  FakeModelProvider,
  InMemoryGenerationStore,
  RunBudgetLedger,
  settledTranscript,
} from '@vibld/core';
import type {
  GenerationPlan,
  GenerationState,
  ProjectFile,
  ProjectSnapshot,
  RunUsageReport,
  TranscriptTurn,
} from '@vibld/core';
import type { ModelProvider } from '@vibld/core';
import type { StylePresetId } from '@vibld/ai/style-presets';
import {
  MAX_CHAT_MESSAGE_CHARS,
  MAX_CHAT_PATH_CHARS,
  MAX_CHAT_PROJECT_FILES,
  MAX_CHAT_SUMMARY_CHARS,
  MAX_CHAT_TOTAL_PATH_CHARS,
  MAX_REFERENCE_CHARS,
} from '@vibld/ai/limits';
import type { ModelOption } from './remote-provider.ts';
import type { ProjectBrief } from './brief.ts';
import { deriveBrief } from './brief.ts';
import type { PlanMode } from './plan-builder.ts';
import { buildPlan } from './plan-builder.ts';
import type { StyleDna } from '@vibld/ai/style-dna';
import type { ParsedMockup } from '@vibld/ai/mockup-schema';
import { requestMockups } from './mockups-client.ts';
import { requestChatTurn } from './chat-client.ts';
import type { ChatMessage, ChatProjectContext } from './chat-client.ts';
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
import type { GenerationMode } from './remote-provider.ts';

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
   * L4) -- decides only what the shell draws, never what it may do. Every
   * `/api/admin/*` route checks the caller itself (ADR-0006).
   *
   * `null` until the `/api/config` probe answers, which `models` above
   * expresses as an empty list because an empty picker is the right thing
   * to show while nobody has answered. There is no such luck here: the
   * admin page has to tell "not an admin" apart from "not asked yet", or
   * it reports that an admin's own page does not exist for as long as a
   * fetch takes, and then replaces it under them.
   */
  isAdmin: boolean | null;
  /**
   * What this deployment can actually generate with, from `/api/config`.
   *
   * Null until the probe answers. It decides one thing: whether to offer
   * directions (internal PR 189 review). `explore` always calls the real
   * `/api/mockups`, while a build in `fake` mode is served by
   * `FakeModelProvider`, so the button was offering something that could
   * only 503 in exactly the modes the fake exists to keep usable.
   *
   * Hidden rather than faked, and the reason is this feature's own
   * argument. `defaultResolveProvider` already says the fake "has no visual
   * vocabulary at all, so a preset cannot change what it produces. Nothing
   * here pretends otherwise." Three invented pages would be precisely the
   * promise the generator has not made that rendered-not-drawn exists to
   * avoid: a reader would choose between sketches nothing built.
   */
  generation: GenerationMode | null;
  /**
   * Directions to choose between, when the caller asked to look before
   * building (internal issue 185). Empty is the ordinary case: most runs never ask.
   */
  mockups: ParsedMockup[];
  /** A mockup run is in flight. Separate from `running`, which is a build. */
  exploring: boolean;
  /**
   * The agent is deciding whether to answer or build (`/api/chat`).
   * Separate from `running`, which is a build: nothing is being written
   * yet, and a reply may mean nothing will be.
   */
  chatting: boolean;
  /**
   * The server project this session is building in, or null when there is
   * none: a deployment without model generation, or a builder that has not
   * opened one yet. Sent with every build so the run lands in the project
   * on screen rather than in whichever one the Worker would guess.
   */
  projectId: string | null;
  /**
   * The composer's style preset and reference page, held here rather than
   * in the composer so that they are part of what a project remembers
   * (docs/decisions.md, 2026-09-28, projects) and come back when it is
   * opened. The composer still owns what happens to them on send: the
   * reference is for one message and is cleared once used.
   */
  style: StylePresetId | null;
  referenceUrl: string;
  /**
   * A project is being opened. The composer waits for it, so nothing typed
   * in the moment before is sent against the project being left.
   */
  opening: boolean;
}

// Where it has always been imported from. The shape moved to @vibld/core
// when the Worker started storing it, so the two cannot drift apart.
export type { TranscriptTurn };

/** What `restore` puts back when a project is opened. */
export interface RestoredProject {
  id: string;
  transcript: TranscriptTurn[];
  /** The accepted code, or null for a project nobody has built in yet. */
  snapshot: ProjectSnapshot | null;
  style: StylePresetId | null;
  referenceUrl: string;
  model: string | null;
  knowledge: string;
  styleDna: StyleDna;
}

/** What a project remembers besides its code and its conversation. */
export interface SessionSettings {
  style: StylePresetId | null;
  referenceUrl: string | null;
  model: string | null;
  knowledge: string;
  styleDna: StyleDna;
}

/**
 * Where a run has got to, as coarsely as the Worker can actually tell.
 *
 * `running` and not `writing` (internal PR 188 review). A Workflow instance reports
 * `running` for the whole of its work, and writing the project is only the
 * first of its three steps: settling the budget and recording the trace
 * follow, each with its own retries. A word that named the writing would go
 * on claiming it for as long as those take.
 */
export type GenerationStage = 'queued' | 'running' | 'thinking';

export interface GenerationProgress {
  /**
   * Characters the model has produced, when that is known.
   *
   * Optional, and absent means unknown rather than none. The Worker reports
   * a count only once a run has produced one (internal issue 183): before the first
   * report, and on a reasoning model for as long as it is still thinking,
   * there is no honest number to send. The wording says nothing rather than
   * saying zero, because a counter frozen at 0 is the frozen line this whole
   * component exists to replace.
   */
  characters?: number;
  elapsedMs: number;
  stage?: GenerationStage;
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
  /** Ask for directions. Injectable so tests need no network. */
  requestMockupsImpl?: typeof requestMockups;
  requestChatTurnImpl?: typeof requestChatTurn;
  resolveProvider?: (
    plan: GenerationPlan,
    signal: AbortSignal,
    onProgress?: (progress: GenerationProgress) => void,
    style?: StylePresetId | null,
    knowledge?: string | null,
    model?: string | null,
    referenceUrl?: string | null,
    styleDna?: StyleDna | null,
    // Appended rather than placed beside the other request-shaped options,
    // for the reason `buildUserPrompt` now carries in its own signature: a
    // parameter added to the middle of a positional list silently re-points
    // every existing caller at the wrong argument.
    mockup?: { label: string; html: string } | null,
    // Last for the same reason: the server project the build is for.
    projectId?: string | null,
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
    isAdmin: null,
    generation: null,
    mockups: [],
    exploring: false,
    chatting: false,
    projectId: null,
    style: null,
    referenceUrl: '',
    opening: false,
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
  mockup?: { label: string; html: string } | null,
  projectId?: string | null,
): Promise<ModelProvider> {
  const mode = await detectGenerationMode();
  return mode === 'model'
    ? new RemoteModelProvider({
        signal,
        ...(projectId ? { projectId } : {}),
        ...(onProgress ? { onProgress } : {}),
        ...(style ? { style } : {}),
        ...(knowledge ? { knowledge } : {}),
        ...(model ? { model } : {}),
        ...(referenceUrl ? { referenceUrl } : {}),
        ...(styleDna && Object.keys(styleDna).length > 0 ? { styleDna } : {}),
        ...(mockup ? { mockup } : {}),
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
  /**
   * The key the in-memory store holds this session's project under. The
   * server project's id once one is opened, and a placeholder before that,
   * which is all a deployment without a server ever has.
   */
  #projectId: string;
  readonly #delay: (ms: number) => Promise<void>;
  readonly #now: () => number;
  readonly #stageDelayMs: number;
  readonly #budgetLimits: ConstructorParameters<typeof RunBudgetLedger>[0];
  readonly #requestMockups: typeof requestMockups;
  readonly #requestChatTurn: typeof requestChatTurn;
  #chatAbort: AbortController | null = null;
  /**
   * The style and reference sent with a message the agent answered rather
   * than built. They were chosen for a build, so they are kept for the
   * next one, which is usually the "yes" that approves what was proposed.
   */
  #pendingBuildOptions: {
    style: StylePresetId | null;
    referenceUrl: string | null;
  } | null = null;
  #mockupContext: {
    prompt: string;
    style: StylePresetId | null;
    referenceUrl: string | null;
  } | null = null;
  /**
   * The look's own controller, separate from the build's `#abort` (internal PR 189
   * review). A mockup run is about a minute and is billed; without this the
   * only way to stop one was to leave the page, and it kept spending either
   * way.
   */
  #exploreAbort: AbortController | null = null;
  readonly #resolveProvider: (
    plan: GenerationPlan,
    signal: AbortSignal,
    onProgress?: (progress: GenerationProgress) => void,
    style?: StylePresetId | null,
    knowledge?: string | null,
    model?: string | null,
    referenceUrl?: string | null,
    styleDna?: StyleDna | null,
    mockup?: { label: string; html: string } | null,
    projectId?: string | null,
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
    this.#requestMockups = options.requestMockupsImpl ?? requestMockups;
    this.#requestChatTurn = options.requestChatTurnImpl ?? requestChatTurn;
    this.#state = initialState(this.#ledger.report());
  }

  getState = (): BuilderState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /**
   * Shut the session down and stop what it is paying for.
   *
   * The epoch and the listeners are about what gets *shown*; the
   * controllers are about what gets *spent*, and this used to do only the
   * first (internal PR 189 review). A non-React owner -- the documented consumer of
   * this method -- could dispose a session mid-run and leave about a minute
   * of billed model time going, with the answer thrown away.
   *
   * Both controllers, not only the look's. The finding named the look,
   * because that is the one this PR added; the build's `#abort` was never
   * cleared here either. That is the third time in this review I have fixed
   * the case that was reported without asking which sibling had the same
   * shape, so this one asks: `reset`, `cancel`, `cancelExplore` and this
   * are the four places that end work, and all four now abort what they
   * end.
   *
   * No state is written, unlike `cancel`. There is nobody left to show it
   * to, and `#disposed` already refuses every later mutation.
   */
  dispose(): void {
    this.#disposed = true;
    this.#epoch += 1;
    this.#abort?.abort();
    this.#abort = null;
    this.#exploreAbort?.abort();
    this.#exploreAbort = null;
    this.#chatAbort?.abort();
    this.#chatAbort = null;
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
  /** What the deployment can generate with, once the probe answers. */
  setGeneration(generation: GenerationMode | null): void {
    if (this.#disposed || generation === this.#state.generation) return;
    this.#state = { ...this.#state, generation };
    this.#emit();
  }

  setIsAdmin(isAdmin: boolean | null): void {
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

  /** The composer's style preset, or null for none. */
  setStyle(style: StylePresetId | null): void {
    if (this.#disposed || style === this.#state.style) return;
    this.#state = { ...this.#state, style };
    this.#emit();
  }

  /** What is in the composer's reference field. */
  setReferenceUrl(referenceUrl: string): void {
    if (this.#disposed || referenceUrl === this.#state.referenceUrl) return;
    this.#state = { ...this.#state, referenceUrl };
    this.#emit();
  }

  /** Whether a project is being opened, which holds the composer. */
  setOpening(opening: boolean): void {
    if (this.#disposed || opening === this.#state.opening) return;
    this.#state = { ...this.#state, opening };
    this.#emit();
  }

  /**
   * What this project should remember about how it is being built, for the
   * autosave.
   *
   * The reference page is the one the next build will read: what is in the
   * field, or, when the agent answered a message instead of building, the
   * one that message carried and the next build will reuse. The second is
   * otherwise held only in this object, out of sight, and would be lost on
   * a reload; saved here, it comes back into the field, where it can be
   * seen and removed.
   */
  settings(): SessionSettings {
    const typed = this.#state.referenceUrl.trim();
    return {
      style: this.#state.style,
      referenceUrl:
        typed.length > 0
          ? typed
          : (this.#pendingBuildOptions?.referenceUrl ?? null),
      model: this.#state.model,
      knowledge: this.#state.knowledge,
      styleDna: this.#state.styleDna,
    };
  }

  /**
   * Open a project: put back its conversation, its accepted code and its
   * settings, and build in it from now on.
   *
   * Everything in flight is stopped first, as `reset` stops it, because it
   * belongs to the project being left: a build that finished after this
   * would otherwise land in the new project's screen, and a chat reply
   * would be answering a conversation nobody can see any more. The Worker
   * stops the run itself when its request is dropped.
   *
   * The accepted code is put into the in-memory store as the project's
   * accepted revision, not only onto the screen. The next build asserts
   * that revision as its base, and the Worker compares it with what it has
   * stored: a session that showed the code without holding its revision
   * would have its first follow-up refused as a conflict with its own
   * project.
   *
   * What the deployment can serve, and whether this is an admin, are not
   * the project's and survive, as they survive `reset`.
   */
  async restore(project: RestoredProject): Promise<void> {
    if (this.#disposed) return;
    const { models, isAdmin, generation } = this.#state;
    this.#epoch += 1;
    const epoch = this.#epoch;
    this.#abort?.abort();
    this.#abort = null;
    this.#exploreAbort?.abort();
    this.#exploreAbort = null;
    this.#chatAbort?.abort();
    this.#chatAbort = null;
    this.#pendingBuildOptions = null;
    this.#mockupContext = null;

    const store = new InMemoryGenerationStore();
    if (project.snapshot) {
      await store.saveStage({
        runId: 'restored',
        projectId: project.id,
        baseRevision: null,
        state: 'validating',
        snapshot: project.snapshot,
      });
      await store.promote(project.id, 'restored', null, project.snapshot);
    }
    // Another project was opened while this one was being put back: the
    // later request wins, and this one leaves nothing behind.
    if (this.#disposed || epoch !== this.#epoch) return;

    this.#store = store;
    this.#projectId = project.id;
    this.#ledger = new RunBudgetLedger(this.#budgetLimits);
    this.#entrySeq = 0;
    const transcript = settledTranscript(project.transcript);
    // New turns and runs are numbered after the ones already in the
    // conversation, so no two turns share an id.
    this.#turnSeq = transcript.reduce((max, turn) => Math.max(max, turn.id), 0);
    this.#runSeq = transcript.reduce((max, turn) => {
      const sequence = Number(/-(\d+)$/.exec(turn.runId)?.[1] ?? 0);
      return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
    }, 0);
    const snapshot = project.snapshot;
    this.#state = {
      ...initialState(this.#ledger.report()),
      models,
      isAdmin,
      generation,
      projectId: project.id,
      transcript,
      acceptedSnapshot: snapshot,
      stagedFiles: snapshot ? snapshot.files.map((file) => ({ ...file })) : [],
      style: project.style,
      referenceUrl: project.referenceUrl,
      model: project.model,
      knowledge: project.knowledge,
      styleDna: project.styleDna,
    };
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
    const { knowledge, model, models, isAdmin, generation, projectId } =
      this.#state;
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
      generation,
      projectId,
    };
    // Directions are about a request, and "Start over" discards the
    // request. Carrying them would leave three sketches of a project that
    // no longer exists, with a Build button that would rebuild it.
    //
    // Aborted, not merely forgotten (internal PR 189 review). Clearing the context
    // and bumping the epoch stops the result being *shown*; it does not
    // stop the run, which is about a minute of billed model time whose
    // answer is then thrown away. Start over is reachable while a look is
    // in flight -- the same failed-first-build state that made the
    // directions button visible again -- so this is a path a reader
    // actually takes.
    this.#exploreAbort?.abort();
    this.#exploreAbort = null;
    this.#chatAbort?.abort();
    this.#chatAbort = null;
    this.#pendingBuildOptions = null;
    this.#mockupContext = null;
    this.#emit();
  }

  /**
   * Ask for three directions rather than a build (internal issue 185).
   *
   * Its own flag rather than reusing `running`: a build and a look are
   * different spends, they read differently on screen, and a chooser that
   * appeared because a build was in flight would be lying about what it
   * was waiting for.
   *
   * The prompt and style that produced the set are kept, because choosing
   * one has to submit the same request it was drawn from. Asking the reader
   * to retype it would be asking them to remember what they already said.
   */
  async explore(
    prompt: string,
    style: StylePresetId | null = null,
    // Kept so choosing can resubmit the request the set was drawn from
    // (internal PR 189 review). Without it a reference page the reader had filled in
    // was silently dropped on the build, while still sitting in the
    // composer looking like it had been used.
    referenceUrl: string | null = null,
  ): Promise<void> {
    const trimmed = prompt.trim();
    if (
      this.#disposed ||
      this.#state.running ||
      this.#state.exploring ||
      trimmed.length === 0
    ) {
      return;
    }
    const epoch = this.#epoch;
    const controller = new AbortController();
    this.#exploreAbort = controller;
    this.#mockupContext = { prompt: trimmed, style, referenceUrl };
    this.#patch(epoch, (state) => ({
      ...state,
      exploring: true,
      mockups: [],
      progress: null,
      problems: [],
    }));

    try {
      const mockups = await this.#requestMockups({
        prompt: trimmed,
        style,
        model: this.#state.model,
        signal: controller.signal,
        onProgress: (progress) => {
          this.#patch(epoch, (state) => ({ ...state, progress }));
        },
      });
      this.#forgetExplore(controller);
      this.#patch(epoch, (state) => ({
        ...state,
        exploring: false,
        progress: null,
        mockups,
      }));
    } catch (error) {
      this.#forgetExplore(controller);
      // A run the reader stopped is not a run that failed. `cancelStop`
      // has already put the session back; reporting the abort on top of
      // that would show an error for something they chose.
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      this.#patch(epoch, (state) => ({
        ...state,
        exploring: false,
        progress: null,
        mockups: [],
        problems: [message],
      }));
    }
  }

  /**
   * Drop the reference to a look that has finished, if it is still ours.
   *
   * The check is the point (internal PR 189 review). `explore` used to clear
   * `#exploreAbort` unconditionally when its promise settled, so an
   * abandoned run landing after Start over -- or after a second look had
   * begun -- cleared the *new* run's controller. Nothing then held it, and
   * Cancel had nothing left to abort: a billed run with no way to stop it,
   * created by the code whose whole job is stopping runs.
   */
  #forgetExplore(controller: AbortController): void {
    if (this.#exploreAbort === controller) this.#exploreAbort = null;
  }

  /**
   * Stop a look that is still running (internal PR 189 review).
   *
   * Aborting the fetch drops the connection, which is what tells the
   * endpoint to stop its own model call -- so this stops the spending
   * rather than only the waiting, the same contract `cancel` has for a
   * build.
   */
  cancelExplore(): void {
    if (this.#disposed || !this.#state.exploring) return;
    this.#exploreAbort?.abort();
    this.#exploreAbort = null;
    this.#state = {
      ...this.#state,
      exploring: false,
      progress: null,
      mockups: [],
    };
    this.#mockupContext = null;
    this.#emit();
  }

  /**
   * Build the direction that was picked, from the request it was drawn
   * from. The set is cleared first: the other two are not alternatives any
   * more, and leaving them on screen beside a running build would invite a
   * second click that the run in flight would refuse anyway.
   */
  chooseMockup(mockup: ParsedMockup): void {
    if (this.#disposed || this.#state.running) return;
    const context = this.#mockupContext;
    if (!context) return;
    this.#state = { ...this.#state, mockups: [] };
    this.#emit();
    void this.submit(
      context.prompt,
      'succeed',
      context.style,
      context.referenceUrl,
      { label: mockup.label, html: mockup.html },
    );
  }

  /** None of them. Clears the set without spending anything further. */
  discardMockups(): void {
    if (this.#disposed || this.#state.mockups.length === 0) return;
    this.#mockupContext = null;
    this.#state = { ...this.#state, mockups: [] };
    this.#emit();
  }

  /**
   * One message in the conversation (docs/decisions.md, 2026-09-28: the
   * agent decides). `/api/chat` either answers in words, which closes the
   * turn as `replied` and changes nothing, or returns a build brief, which
   * is submitted exactly as a typed prompt would be, under the person's own
   * words and the agent's one line about what it is doing.
   *
   * Only against a real model. The deterministic provider has nobody to
   * talk to, and a forced failure is a test of the build path, so both go
   * straight to `submit`.
   */
  async send(
    prompt: string,
    mode: PlanMode = 'succeed',
    style: StylePresetId | null = null,
    referenceUrl: string | null = null,
  ): Promise<void> {
    const trimmed = prompt.trim();
    if (
      this.#disposed ||
      this.#state.running ||
      this.#state.chatting ||
      this.#state.exploring ||
      trimmed.length === 0
    ) {
      return;
    }
    if (this.#state.generation !== 'model' || mode !== 'succeed') {
      return this.submit(trimmed, mode, style, referenceUrl);
    }

    // Chosen for a build. A reply leaves them for the next build, which is
    // usually the "yes" to what the agent proposed.
    const pending = this.#pendingBuildOptions;
    const buildStyle = style ?? pending?.style ?? null;
    const buildReference = referenceUrl ?? pending?.referenceUrl ?? null;

    // Directions belong to the request they were drawn for, and this is a
    // new one either way.
    this.#mockupContext = null;
    const epoch = this.#epoch;
    this.#runSeq += 1;
    const runId = `chat-${this.#runSeq}`;
    const messages: ChatMessage[] = [
      ...this.#conversation(),
      { role: 'user', text: trimmed },
    ];
    const project = this.#projectContext();
    const controller = new AbortController();
    this.#chatAbort = controller;
    this.#patch(epoch, (state) => ({
      ...state,
      chatting: true,
      mockups: [],
      transcript: this.#openTurn(state.transcript, runId, trimmed),
    }));

    const result = await this.#requestChatTurn({
      messages,
      project,
      model: this.#state.model,
      signal: controller.signal,
    });
    if (this.#chatAbort === controller) this.#chatAbort = null;
    if (this.#disposed || epoch !== this.#epoch) return;

    if (!result.ok) {
      // A cancellation already closed the turn, as `cancelled`.
      if (result.error.kind === 'aborted') return;
      const problem = result.error.message;
      this.#patch(epoch, (state) => ({
        ...state,
        chatting: false,
        transcript: this.#closeTurn(state.transcript, {
          status: 'failed',
          problem,
        }),
        timeline: this.#append(state.timeline, 'error', problem),
      }));
      return;
    }

    const turn = result.turn;
    if (turn.action === 'reply') {
      this.#pendingBuildOptions =
        buildStyle || buildReference
          ? { style: buildStyle, referenceUrl: buildReference }
          : null;
      this.#patch(epoch, (state) => ({
        ...state,
        chatting: false,
        transcript: this.#closeTurn(state.transcript, {
          status: 'replied',
          agentMessage: turn.message,
        }),
      }));
      return;
    }

    // A build. The deciding turn is replaced by the build's own, which
    // `submit` opens under the same words, so the conversation shows one
    // exchange rather than a question and then a second copy of it.
    this.#pendingBuildOptions = null;
    const last = this.#state.transcript.at(-1);
    this.#state = {
      ...this.#state,
      chatting: false,
      transcript:
        last?.runId === runId
          ? this.#state.transcript.slice(0, -1)
          : this.#state.transcript,
    };
    this.#emit();
    await this.submit(turn.brief, 'succeed', buildStyle, buildReference, null, {
      prompt: trimmed,
      agentMessage: turn.message,
    });
  }

  /**
   * The conversation so far, as `/api/chat` reads it: each message and
   * what came of it. A build's outcome is said in words, because what the
   * agent needs to know is what happened, not the shape of this state.
   */
  #conversation(): ChatMessage[] {
    const clip = (text: string) => text.slice(0, MAX_CHAT_MESSAGE_CHARS);
    const messages: ChatMessage[] = [];
    for (const turn of this.#state.transcript) {
      if (turn.status === 'running') continue;
      const said: string[] = [];
      if (turn.agentMessage) said.push(turn.agentMessage);
      if (turn.status === 'accepted') {
        said.push(
          turn.summary
            ? `Built it: ${turn.summary}`
            : `Built it (${turn.fileCount} files).`,
        );
      } else if (turn.status === 'failed') {
        said.push(
          `That did not work${turn.problem ? `: ${turn.problem}` : '.'} Nothing was changed.`,
        );
      } else if (turn.status === 'cancelled') {
        said.push('Cancelled. Nothing was changed.');
      }
      messages.push({ role: 'user', text: clip(turn.prompt) });
      if (said.length > 0) {
        messages.push({ role: 'assistant', text: clip(said.join(' ')) });
      }
    }
    return messages;
  }

  /**
   * The accepted project as `/api/chat` takes it: its summary and its file
   * paths, never their contents, and within the Worker's own bounds, which
   * refuse rather than trim. A large project is described by its first
   * paths rather than turned away.
   */
  #projectContext(): ChatProjectContext | null {
    const snapshot = this.#state.acceptedSnapshot;
    if (!snapshot) return null;
    const accepted = [...this.#state.transcript]
      .reverse()
      .find((turn) => turn.status === 'accepted');
    const files: string[] = [];
    let total = 0;
    for (const file of snapshot.files) {
      if (files.length >= MAX_CHAT_PROJECT_FILES) break;
      if (file.path.length > MAX_CHAT_PATH_CHARS) continue;
      if (/[\u0000-\u001f\u007f]/.test(file.path)) continue;
      if (total + file.path.length > MAX_CHAT_TOTAL_PATH_CHARS) break;
      total += file.path.length;
      files.push(file.path);
    }
    return {
      summary: accepted?.summary?.slice(0, MAX_CHAT_SUMMARY_CHARS) ?? null,
      files,
    };
  }

  async submit(
    prompt: string,
    mode: PlanMode = 'succeed',
    style: StylePresetId | null = null,
    referenceUrl: string | null = null,
    mockup: { label: string; html: string } | null = null,
    /**
     * How the turn reads in the conversation, when the build was decided by
     * the agent (`send`): the person's own words, and the agent's line about
     * what it is doing. The build itself runs on `prompt`, the agent's
     * brief, which carries everything agreed in the conversation.
     */
    display: { prompt: string; agentMessage: string } | null = null,
  ): Promise<void> {
    const trimmed = prompt.trim();
    if (this.#disposed || this.#state.running || trimmed.length === 0) return;
    const shown = display?.prompt ?? trimmed;
    const said = { agentMessage: display?.agentMessage ?? null };

    // Any build invalidates the directions, not only choosing one
    // (internal PR 189 review). Pressing Generate with a set on screen used to leave
    // it there; once that build was accepted the chooser came back enabled,
    // and clicking a tile then submitted its *pre-build* request against
    // the project that had just been created -- a follow-up nobody asked
    // for, at the price of a full build.
    //
    // Here rather than in the two callers, because the callers are the
    // composer and `chooseMockup`, and the rule is about what a build does
    // to a set, not about who started it. `chooseMockup` reads the context
    // into locals before it calls this, so clearing it here is safe.
    this.#mockupContext = null;
    if (this.#state.mockups.length > 0) {
      this.#state = { ...this.#state, mockups: [] };
    }

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
      (referenceUrl ? estimateTokensForChars(MAX_REFERENCE_CHARS) : 0) +
      // A chosen direction is sent with the request too (internal issue 185), so it is
      // part of what this run spends. Counted from the document actually
      // being sent rather than from its cap, because unlike a reference URL
      // this content is already in hand.
      (mockup ? estimateTokensForChars(mockup.html.length) : 0);
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
        transcript: this.#openTurn(state.transcript, runId, shown, {
          ...said,
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
      transcript: this.#openTurn(state.transcript, runId, shown, said),
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
        mockup,
        this.#state.projectId,
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
    if (this.#disposed) return;
    if (this.#state.chatting) {
      // The agent has not decided anything yet, so there is no build to
      // stop and no checkpoint to protect: only the question to withdraw.
      this.#chatAbort?.abort();
      this.#chatAbort = null;
      this.#epoch += 1;
      this.#state = {
        ...this.#state,
        chatting: false,
        transcript: this.#closeTurn(this.#state.transcript, {
          status: 'cancelled',
        }),
      };
      this.#emit();
      return;
    }
    if (!this.#state.running) return;

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
        agentMessage: null,
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
