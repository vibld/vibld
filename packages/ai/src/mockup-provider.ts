import {
  MOCKUP_SYSTEM_PROMPT,
  MockupSetSchema,
  mockupUserPrompt,
} from './mockup-schema.ts';
import { MOCKUP_OUTPUT } from './plan-output.ts';
import type { ParsedMockupSet } from './mockup-schema.ts';
import { MOCKUP_SUBJECT } from './errors.ts';
import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  mockupMaxTokensFor,
  readCompletion,
} from './plan-provider.ts';
import { styleDirection } from './style-presets.ts';
import type { StylePresetId } from './style-presets.ts';
import type {
  PlanClient,
  PlanEffort,
  PlanProgress,
  PlanCompletion,
  PlanDiagnostics,
  PlanUsage,
} from './client.ts';

/**
 * Three directions to choose between, before a build is attempted (#185).
 *
 * Not `ModelProvider`. That interface returns a `GenerationPlan` -- a
 * project -- and this returns something a person looks at and then throws
 * two thirds of away. Bending one into the other would have meant a plan
 * whose "files" were not files, and every consumer of a plan would have had
 * to learn the difference.
 *
 * It shares `readCompletion` with `PlanProvider`, which is the part the two
 * genuinely agree on: why a call stopped, and whether the JSON is the shape
 * asked for. Everything else here is different on purpose -- a different
 * system prompt, a ceiling an order of magnitude smaller, and no style DNA,
 * knowledge, palette or reference context, because the point of this run is
 * to find out what the person wants rather than to apply what they have
 * already said.
 *
 * One exception: a chosen style preset is passed through when there is one.
 * Somebody who has already picked a direction is asking for three takes
 * within it, not three arguments against it.
 */
export interface MockupProviderOptions {
  model?: string;
  maxTokens?: number;
  effort?: PlanEffort;
  onUsage?: (usage: PlanUsage) => void;
  /**
   * What the run spent that the usage figures do not explain, where the
   * client reports it (#190). Separate from `onUsage` because it is
   * provider-specific and optional: a client with nothing to say calls
   * neither this nor anything else.
   */
  onDiagnostics?: (diagnostics: PlanDiagnostics) => void;
  /**
   * An attempt that was thrown away and not billed to the caller, so
   * whoever runs this can see what it absorbed (#190).
   *
   * Without it the retry below hides real money: the provider charges for
   * an empty reply, the reader is not charged, and nothing anywhere says
   * how often that happens. Invisible spend is the failure this whole
   * thread has been about.
   *
   * It is also where the retry is permitted, because this is the only
   * moment at which a caller knows what the absorbed attempt cost and the
   * second one has not yet been sent (#191 review). Returning false
   * refuses it, and the run then fails on the empty reply it already has
   * rather than spending again. The Worker refuses when the account-wide
   * daily ceiling cannot cover another attempt: absorbing a provider
   * defect is a decision about who pays, never a way to spend past a
   * ceiling.
   *
   * Only an explicit false refuses. A caller that reports and returns
   * nothing is permitting, which is what every existing caller meant when
   * this reported and nothing else.
   */
  onDiscarded?: (usage: PlanUsage) => boolean | void | Promise<boolean | void>;
  signal?: AbortSignal;
  /**
   * Called as output arrives (#189 review). The claim that this route
   * restores a real character count was written before the callback was
   * threaded, so it was false: the provider never asked the client for
   * progress, and the client never reported any.
   */
  onProgress?: (progress: PlanProgress) => void;
  /**
   * How large a prompt the client actually sent, reported once.
   *
   * Forwarded rather than reconstructed, because the assembly is
   * provider-specific: DeepSeek appends the output instruction to the
   * system message, Anthropic and OpenAI carry the schema structurally
   * instead (#189 review).
   */
  onPromptChars?: (characters: number) => void;
  style?: StylePresetId;
}

export interface MockupRequest {
  prompt: string;
}

export class MockupProvider {
  readonly id: string;
  readonly #client: PlanClient;
  readonly #model: string;
  readonly #maxTokens: number;
  readonly #effort: PlanEffort;
  readonly #onUsage?: (usage: PlanUsage) => void;
  readonly #onDiagnostics?: (diagnostics: PlanDiagnostics) => void;
  readonly #onDiscarded?: MockupProviderOptions['onDiscarded'];
  readonly #signal?: AbortSignal;
  readonly #onProgress?: (progress: PlanProgress) => void;
  readonly #onPromptChars?: (characters: number) => void;
  readonly #style?: StylePresetId;

  constructor(client: PlanClient, options: MockupProviderOptions = {}) {
    this.#client = client;
    this.#model = options.model ?? DEFAULT_MODEL;
    this.#maxTokens = options.maxTokens ?? mockupMaxTokensFor(this.#model);
    this.#effort = options.effort ?? DEFAULT_EFFORT;
    this.#onUsage = options.onUsage;
    this.#onDiagnostics = options.onDiagnostics;
    this.#onDiscarded = options.onDiscarded;
    this.#signal = options.signal;
    this.#onProgress = options.onProgress;
    this.#style = options.style;
    this.#onPromptChars = options.onPromptChars;
    this.id = `${client.id}:${this.#model}`;
  }

  async generate(request: MockupRequest): Promise<ParsedMockupSet> {
    const first = await this.#ask(request);

    /*
     * One retry, for an empty reply and nothing else (#190).
     *
     * DeepSeek's JSON mode documents that it "may occasionally return
     * empty content", and a real run produced exactly that: 22,828
     * characters streamed, 24,322 output tokens billed, and `null` where
     * the object should have been. Not a truncation and not a wrong
     * answer, so failing the reader on it is failing them for a provider
     * defect.
     *
     * Narrow on purpose. A reply that is the wrong *shape* is a
     * disagreement the model will most likely repeat, so retrying it just
     * spends twice and fails anyway; only "nothing came back" is retried.
     * A refusal and a truncation are answers, and are not retried either.
     *
     * The discarded attempt is not billed to the caller: they did not
     * cause it, and one empty reply is about two and a half cents. It is
     * reported through `onDiscarded` instead, so the cost is absorbed
     * visibly rather than quietly.
     *
     * And absorbed is not the same as unaccounted, which is what the
     * first version of this confused (#191 review). `onDiscarded` is
     * awaited and may refuse, so a caller that answers to a spend ceiling
     * can record the attempt and decline the second one. Deciding not to
     * charge a reader is ours to make; spending past a ceiling because
     * nobody was charged is not.
     */
    let completion = first;
    if (isEmptyReply(first)) {
      if ((await this.#onDiscarded?.(first.usage)) === false) {
        /*
         * Refused, so this attempt is the whole run -- and it is the one
         * just declared absorbed (#191 review).
         *
         * Returning here rather than falling through is the whole fix.
         * Below, `onUsage` reports what the caller is to be billed for,
         * and the first version of this veto reported the absorbed
         * attempt through it: the reader was charged for exactly the
         * defect this branch exists to spare them, and a caller that had
         * already recorded it as absorbed put it on the account ledger a
         * second time.
         *
         * So the attempt leaves by one door only. `onDiscarded` above
         * has it, and nothing else is told about it.
         */
        return readCompletion(
          first,
          this.#maxTokens,
          MockupSetSchema,
          MOCKUP_SUBJECT,
        );
      }
      /*
       * Every meter goes back to zero before the second attempt starts
       * (#191 review, twice).
       *
       * A caller watching these holds the last figure it was given, and
       * settles a cancelled run from them. Left standing, the absorbed
       * attempt's counts are what a reader who cancels during the retry
       * is charged for -- the attempt this branch just declared absorbed,
       * which is the opposite of what `onDiscarded` above is for.
       *
       * Zero rather than an attempt-boundary event, because every consumer
       * of these already means "so far" by them, and for a run that is
       * starting again, so far is nothing.
       *
       * The prompt size joins the progress counts, because the client
       * reports it before it sends, so it restores itself the moment the
       * retry really goes out. When the retry does not go out, zero is
       * what a reader owes for a request that never left.
       */
      this.#onProgress?.({ characters: 0, reasoningCharacters: 0 });
      this.#onPromptChars?.(0);

      /*
       * Cancelled while the answer above was awaited (#191 review).
       *
       * The route checks this before the first attempt and could not
       * check it here, because the awaiting happens inside this method.
       * A reader who disconnects while the caller is reaching a ledger
       * would otherwise have a second request built and sent on an
       * already-aborted signal: it rejects without reporting usage, and
       * settlement then prices a request that never left the Worker.
       *
       * The run leaves as the empty reply it has, which is what it was
       * going to be. Both meters are already at zero above, so the
       * cancellation settles at nothing, which is what one absorbed
       * attempt and one request never sent really cost the reader.
       */
      if (this.#signal?.aborted) {
        return readCompletion(
          first,
          this.#maxTokens,
          MockupSetSchema,
          MOCKUP_SUBJECT,
        );
      }

      completion = await this.#ask(request);
    }

    // Reported before anything can throw, for the same reason the build
    // provider does it: a refusal or a truncation still spends tokens, and
    // a ledger that counts only successes under-reports the bill.
    this.#onUsage?.(completion.usage);
    if (completion.diagnostics) this.#onDiagnostics?.(completion.diagnostics);

    // Named, so a truncation talks about three directions rather than about
    // a project nobody asked this route for (#190).
    return readCompletion(
      completion,
      this.#maxTokens,
      MockupSetSchema,
      MOCKUP_SUBJECT,
    );
  }

  /** One attempt, with nothing reported and nothing validated. */
  async #ask(request: MockupRequest): Promise<PlanCompletion> {
    const direction = this.#style ? styleDirection(this.#style) : null;
    return this.#client.createPlan({
      system: MOCKUP_SYSTEM_PROMPT,
      prompt: mockupUserPrompt(request.prompt, direction),
      model: this.#model,
      maxTokens: this.#maxTokens,
      effort: this.#effort,
      // The shape this provider is about to validate, told to the client
      // that is about to ask for it (#189 review). Without this the client
      // constrained the reply to a generation plan while the system prompt
      // above asked for a set of directions, so on Anthropic and OpenAI the
      // run could not succeed and on DeepSeek it was being argued with.
      output: MOCKUP_OUTPUT,
      ...(this.#signal ? { signal: this.#signal } : {}),
      ...(this.#onProgress ? { onProgress: this.#onProgress } : {}),
      // Forwarded so the caller can settle a cancelled run from what was
      // really sent. Only the client knows: DeepSeek appends the output
      // instruction to the system message and the other two do not
      // (#189 review).
      ...(this.#onPromptChars ? { onPromptChars: this.#onPromptChars } : {}),
    });
  }
}

/**
 * Nothing came back, as distinct from anything else that leaves a null plan.
 *
 * The first version of this read `completion.plan === null`, and the commit
 * message called it narrow. It was not (#191 review). `readJsonPlan`
 * returns null for an empty body *and* for JSON it cannot parse, and a
 * refusal and a truncation can both arrive with a null plan as well. So the
 * predicate retried all four: a truncation and a refusal would each have
 * been asked again at full price, and the answer the run had actually given
 * would have been replaced by whatever came back second.
 *
 * Two conditions now, and both are facts rather than inferences. The client
 * says whether the body was empty, because only it can tell. And a stop
 * reason that is itself an answer is never retried, whatever the body was:
 * a model that stopped at the ceiling or declined has told us something, and
 * asking again spends twice to hear it again.
 */
function isEmptyReply(completion: PlanCompletion): boolean {
  if (completion.emptyBody !== true) return false;
  return (
    completion.stopReason !== 'refusal' &&
    completion.stopReason !== 'max_tokens'
  );
}
