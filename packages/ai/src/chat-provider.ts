import {
  CHAT_SYSTEM_PROMPT,
  ChatDecisionSchema,
  chatUserPrompt,
  toChatTurn,
} from './chat-schema.ts';
import type {
  ChatMessage,
  ChatProjectContext,
  ChatTurn,
} from './chat-schema.ts';
import { CHAT_OUTPUT } from './plan-output.ts';
import { CHAT_SUBJECT } from './errors.ts';
import {
  CHAT_EFFORT,
  DEFAULT_MODEL,
  chatMaxTokensFor,
  readCompletion,
} from './plan-provider.ts';
import type {
  PlanClient,
  PlanEffort,
  PlanProgress,
  PlanUsage,
} from './client.ts';

/**
 * One chat turn: reply in words, or hand back a brief to build from
 * (docs/decisions.md, "Resolved 2026-09-28").
 *
 * The same seam as `MockupProvider` and for the same reason: what comes
 * back is not a project, so it is not a `ModelProvider`. It shares
 * `readCompletion` with both of the others, which is the part all three
 * agree on: why a call stopped, and whether the JSON is the shape asked for.
 *
 * One call, no retry. A mockup run absorbs one empty reply because it is a
 * minute of somebody's time; a turn is seconds, and a failed one is asked
 * again by typing. Keeping it to one call also keeps its settlement to the
 * one ordinary case: what the call reported is what is charged.
 */
export interface ChatProviderOptions {
  model?: string;
  maxTokens?: number;
  effort?: PlanEffort;
  /**
   * What the call consumed, reported before the reply is validated, so a
   * reply that fails validation is still charged for what it cost.
   */
  onUsage?: (usage: PlanUsage) => void;
  signal?: AbortSignal;
  /** Forwarded to the client, so a cancelled turn can be settled. */
  onProgress?: (progress: PlanProgress) => void;
  /** Forwarded to the client, for the same reason. */
  onPromptChars?: (characters: number) => void;
}

export interface ChatRequest {
  /** The conversation so far, ending with the message to act on. */
  messages: readonly ChatMessage[];
  /** The current accepted checkpoint, or null before the first build. */
  project: ChatProjectContext | null;
}

export class ChatProvider {
  readonly id: string;
  readonly #client: PlanClient;
  readonly #model: string;
  readonly #maxTokens: number;
  readonly #effort: PlanEffort;
  readonly #onUsage?: (usage: PlanUsage) => void;
  readonly #signal?: AbortSignal;
  readonly #onProgress?: (progress: PlanProgress) => void;
  readonly #onPromptChars?: (characters: number) => void;

  constructor(client: PlanClient, options: ChatProviderOptions = {}) {
    this.#client = client;
    this.#model = options.model ?? DEFAULT_MODEL;
    this.#maxTokens = options.maxTokens ?? chatMaxTokensFor(this.#model);
    this.#effort = options.effort ?? CHAT_EFFORT;
    this.#onUsage = options.onUsage;
    this.#signal = options.signal;
    this.#onProgress = options.onProgress;
    this.#onPromptChars = options.onPromptChars;
    this.id = `${client.id}:${this.#model}`;
  }

  async respond(request: ChatRequest): Promise<ChatTurn> {
    const completion = await this.#client.createPlan({
      system: CHAT_SYSTEM_PROMPT,
      prompt: chatUserPrompt(request.messages, request.project),
      model: this.#model,
      maxTokens: this.#maxTokens,
      effort: this.#effort,
      // The shape validated below, told to the client that asks for it, so
      // the API constrains the reply to the same thing (internal PR 189 review).
      output: CHAT_OUTPUT,
      ...(this.#signal ? { signal: this.#signal } : {}),
      ...(this.#onProgress ? { onProgress: this.#onProgress } : {}),
      ...(this.#onPromptChars ? { onPromptChars: this.#onPromptChars } : {}),
    });

    // Before anything can throw: a refusal, a truncation or a reply of the
    // wrong shape still spent tokens.
    this.#onUsage?.(completion.usage);

    return toChatTurn(
      readCompletion(
        completion,
        this.#maxTokens,
        ChatDecisionSchema,
        CHAT_SUBJECT,
      ),
    );
  }
}
