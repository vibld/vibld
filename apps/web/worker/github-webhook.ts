/**
 * Reading a GitHub webhook delivery: is it really from GitHub, and what does
 * it say happened to a pull request (#13)?
 *
 * Pure, and apart from the handler that stores the result, for the reason
 * every other decision in this codebase is split that way: the parts worth
 * getting right here are a signature comparison and a state reading, and
 * both are testable without a database or a network.
 *
 * This is the one route in the GitHub integration nobody is signed in for.
 * A delivery arrives from GitHub's own infrastructure with no session, so
 * the signature is the whole of the authentication: everything below treats
 * an unverified body as something a stranger wrote, because that is exactly
 * what it might be.
 */

import { isPullRequestState } from './github-store.ts';
import type { PullRequestState } from './github-store.ts';

async function hmac(secret: string, body: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
  );
}

/** Constant time, so a comparison cannot be walked one byte at a time. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index]! ^ b[index]!;
  }
  return difference === 0;
}

function fromHex(value: string): Uint8Array | null {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Whether this body was signed with the webhook secret.
 *
 * The header is `sha256=<hex>`. The prefix is required rather than
 * tolerated: accepting a bare digest would accept a `sha1=` signature as
 * well, and GitHub still sends one for compatibility with endpoints that
 * asked for it.
 *
 * Over the raw body text, which is why the caller reads the body as text
 * before parsing it. Re-serializing parsed JSON produces different bytes and
 * therefore a different digest, which is the classic way a verification
 * function ends up rejecting every genuine delivery.
 */
export async function isSignedByGitHub(
  secret: string,
  body: string,
  header: string | null,
): Promise<boolean> {
  if (!secret || !header) return false;
  const [algorithm, digest] = header.split('=');
  if (algorithm !== 'sha256' || !digest) return false;
  const given = fromHex(digest);
  if (!given) return false;
  return sameBytes(await hmac(secret, body), given);
}

/** What a `pull_request` delivery says, once it has been believed. */
export interface PullRequestEvent {
  owner: string;
  repo: string;
  /** The head ref, which is how a delivery names the push it belongs to. */
  branch: string;
  number: number;
  url: string;
  state: PullRequestState;
  updatedAt: string;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The pull request a delivery is about, or null for a delivery this does not
 * act on.
 *
 * Null covers three different things on purpose, because the caller does the
 * same thing with all of them: an event type this does not handle, a body it
 * could not read, and a pull request that names no branch. None of them is a
 * failure worth answering with an error, and GitHub retries a non-2xx.
 *
 * `merged` is read from the boolean rather than from the state, because the
 * state of a merged pull request is `closed`. Reading only the state would
 * report every merge as a closure, which is the one confusion this
 * vocabulary exists to prevent.
 */
export function pullRequestFrom(
  event: string,
  body: unknown,
): PullRequestEvent | null {
  if (event !== 'pull_request') return null;
  if (typeof body !== 'object' || body === null) return null;

  const payload = body as {
    pull_request?: unknown;
    repository?: unknown;
  };
  const pull = (payload.pull_request ?? {}) as {
    number?: unknown;
    html_url?: unknown;
    state?: unknown;
    merged?: unknown;
    merged_at?: unknown;
    updated_at?: unknown;
    head?: unknown;
  };
  const repository = (payload.repository ?? {}) as {
    name?: unknown;
    owner?: unknown;
  };

  const owner = asString((repository.owner as { login?: unknown })?.login);
  const repo = asString(repository.name);
  const branch = asString((pull.head as { ref?: unknown })?.ref);
  const url = asString(pull.html_url);
  const number = typeof pull.number === 'number' ? pull.number : null;
  if (!owner || !repo || !branch || !url || number === null) return null;

  const merged = pull.merged === true || asString(pull.merged_at) !== null;
  const reported = merged ? 'merged' : pull.state;
  if (!isPullRequestState(reported)) return null;

  return {
    owner,
    repo,
    branch,
    number,
    url,
    state: reported,
    // GitHub's own clock. Deliveries arrive out of order, and this is what
    // decides which of two answers about one pull request is the later one.
    updatedAt: asString(pull.updated_at) ?? new Date(0).toISOString(),
  };
}
