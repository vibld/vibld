import { MAX_CHAT_MESSAGES, MAX_CHAT_TOTAL_CHARS } from '@vibld/ai/limits';
import type {
  ChatMessage,
  ChatProjectContext,
  ChatTurn,
} from '@vibld/ai/chat-schema';
import { isRunRefusal } from '@vibld/core';
import type { RunRefusal } from '@vibld/core';
import { getClerkToken } from '../auth/clerk-token.ts';

/**
 * One turn of the builder's conversation, asked of `/api/chat`
 * (docs/decisions.md, "Resolved 2026-09-28").
 *
 * A plain function, like `requestMockups`, and not wired into the session:
 * the chat box that calls it is being designed separately. What it returns
 * is either the turn (a reply to show, or a reply plus a brief to submit
 * through the existing build path) or a typed error. It never throws, so a
 * caller handles one value rather than a value and an exception.
 */

export type { ChatMessage, ChatProjectContext, ChatTurn };

export type ChatErrorKind =
  /** No usable sign-in. The same case `SignInRequiredError` covers. */
  | 'sign-in-required'
  /** Refused before the model was asked; `reason` says which refusal. */
  | 'refused'
  /** The model was asked and the turn failed; `stop` says how, if known. */
  | 'failed'
  /** The caller's signal aborted the request. */
  | 'aborted'
  /** The request never got an answer. */
  | 'network'
  /** An answer came back that is not a turn. */
  | 'invalid-response';

export interface ChatError {
  kind: ChatErrorKind;
  /** A sentence for the person, from the Worker where it sent one. */
  message: string;
  status?: number;
  /** The refusal identifier, for a `refused` error. */
  reason?: RunRefusal;
  /** True when the invite gate refused, as `/api/access/status` reports. */
  accessRefused?: boolean;
  /** How the run stopped (`RunStop`), for a `failed` error. */
  stop?: string;
}

export type ChatResult =
  { ok: true; turn: ChatTurn; model: string } | { ok: false; error: ChatError };

export interface ChatRunOptions {
  /** The conversation so far, ending with the new user message. */
  messages: readonly ChatMessage[];
  /** The current accepted checkpoint, or null before the first build. */
  project?: ChatProjectContext | null;
  model?: string | null;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  getToken?: () => Promise<string | null>;
  endpoint?: string;
}

/**
 * The most recent messages that fit the Worker's bounds, oldest first.
 *
 * The Worker keeps the most recent `MAX_CHAT_MESSAGES` itself, but refuses a
 * conversation past `MAX_CHAT_TOTAL_CHARS` rather than trimming it, so the
 * trimming by size happens here, before the request is sent. The last
 * message is always kept, even alone past the bound: it is the one being
 * asked about, and the Worker's refusal of it is the honest answer.
 */
export function fitConversation(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  const kept: ChatMessage[] = [];
  let total = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (kept.length >= MAX_CHAT_MESSAGES) break;
    if (kept.length > 0 && total + message.text.length > MAX_CHAT_TOTAL_CHARS) {
      break;
    }
    total += message.text.length;
    kept.unshift({ role: message.role, text: message.text });
  }
  return kept;
}

/** The turn in a response body, or null if it is not one. */
export function readChatTurn(value: unknown): ChatTurn | null {
  if (typeof value !== 'object' || value === null) return null;
  const { action, message, brief } = value as {
    action?: unknown;
    message?: unknown;
    brief?: unknown;
  };
  if (typeof message !== 'string' || message.trim().length === 0) return null;
  if (action === 'reply') return { action, message };
  if (action === 'build') {
    if (typeof brief !== 'string' || brief.trim().length === 0) return null;
    return { action, message, brief };
  }
  return null;
}

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export async function requestChatTurn(
  options: ChatRunOptions,
): Promise<ChatResult> {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const getToken = options.getToken ?? getClerkToken;
  const aborted: ChatResult = {
    ok: false,
    error: { kind: 'aborted', message: 'Cancelled.' },
  };

  let response: Response;
  try {
    if (options.signal?.aborted) return aborted;
    const token = await getToken();
    response = await doFetch(options.endpoint ?? '/api/chat', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        messages: fitConversation(options.messages),
        ...(options.project ? { project: options.project } : {}),
        ...(options.model ? { model: options.model } : {}),
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (isAbort(error, options.signal)) return aborted;
    return {
      ok: false,
      error: {
        kind: 'network',
        message: 'Could not reach vibld. Check your connection and try again.',
      },
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (isAbort(error, options.signal)) return aborted;
    body = null;
  }
  const fields = (
    typeof body === 'object' && body !== null ? body : {}
  ) as Record<string, unknown>;
  const sentence =
    typeof fields.error === 'string' && fields.error.length > 0
      ? fields.error
      : null;

  if (response.status === 401) {
    return {
      ok: false,
      error: {
        kind: 'sign-in-required',
        status: 401,
        message:
          sentence ?? 'Sign in to chat -- use the "Sign in" button above.',
        ...(isRunRefusal(fields.reason) ? { reason: fields.reason } : {}),
      },
    };
  }

  if (!response.ok) {
    const reason = isRunRefusal(fields.reason) ? fields.reason : undefined;
    const stop = typeof fields.stop === 'string' ? fields.stop : undefined;
    return {
      ok: false,
      error: {
        kind: reason ? 'refused' : 'failed',
        status: response.status,
        message: sentence ?? `Could not answer that (${response.status}).`,
        ...(reason ? { reason } : {}),
        ...(fields.accessRefused === true ? { accessRefused: true } : {}),
        ...(stop ? { stop } : {}),
      },
    };
  }

  const turn = readChatTurn(fields.turn);
  if (!turn || typeof fields.model !== 'string') {
    return {
      ok: false,
      error: {
        kind: 'invalid-response',
        status: response.status,
        message: 'The chat service returned an unexpected response.',
      },
    };
  }
  return { ok: true, turn, model: fields.model };
}
