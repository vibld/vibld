/**
 * Let somebody past Clerk as well as past this deployment's own invite list.
 *
 * Clerk is in Waitlist mode (docs/decisions.md L5), so an invite row here
 * lets somebody through the access gate and does not let them create a
 * session. Unapproved in Clerk they cannot sign in at all, so they never
 * reach the gate to be admitted by it. Issuing an invite was therefore half
 * an action, and the panel had to say so.
 *
 * Raw `fetch` against Clerk's Backend API, the same as `clerk-lookup.ts` and
 * for the reason its comment gives: this Worker already hand-rolls Clerk
 * session verification, and a couple of calls do not earn a dependency.
 *
 * **What this does not assume.** Clerk documents `POST /v1/invitations` as
 * the way to invite programmatically, and documents waitlist entries as
 * carrying a status of pending, invited, completed or rejected. It does not
 * document whether creating an invitation moves a waitlist entry, and the
 * answer decides whether "approved" is true. So this does not decide: it
 * makes the call and then reads the entry back, and reports the status Clerk
 * itself gives. If the invitation turns out not to admit a waitlisted
 * person, the panel says they are still waiting rather than claiming they
 * are in.
 */

export interface ClerkWaitlistEnv {
  /** The same Worker secret `clerk-lookup.ts` uses. Never sent to the browser. */
  CLERK_SECRET_KEY?: string;
}

export function clerkAdmissionConfigured(env: ClerkWaitlistEnv): boolean {
  return Boolean(env.CLERK_SECRET_KEY);
}

/**
 * What happened, in terms of what was established rather than what was
 * attempted.
 *
 * `still-waiting` is the case worth having separately: the call was made,
 * Clerk answered, and Clerk says this person is not admitted. Reporting that
 * as an error would suggest trying again; reporting it as success would be
 * the false claim this whole module exists to avoid.
 */
export type ClerkAdmission =
  | { admitted: true; via: 'waitlist' | 'invitation' }
  | { admitted: false; reason: 'unconfigured' }
  | {
      admitted: false;
      reason: 'still-waiting';
      status: string;
      invited: boolean;
    }
  | { admitted: false; reason: 'error'; error: string };

const CLERK_API = 'https://api.clerk.com/v1';
const TIMEOUT_MS = 8_000;

/** Statuses that mean Clerk will let this person create a session. */
const ADMITTED = new Set(['invited', 'completed']);

interface WaitlistEntry {
  email_address?: unknown;
  status?: unknown;
}

/**
 * The waitlist entry for this address, or null when there is none.
 *
 * `query` is a search rather than an exact match, so the address is compared
 * again here: a search for `sam@example.com` that returns
 * `sam@example.com.au` must not be read as this person's row.
 */
async function entryFor(
  env: ClerkWaitlistEnv,
  email: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; status: string | null } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${CLERK_API}/waitlist_entries?query=${encodeURIComponent(email)}`,
      {
        headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch {
    return { ok: false, error: 'Could not reach Clerk to check the waitlist.' };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: `Clerk refused the waitlist read (${response.status}).`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: 'Clerk returned an unreadable waitlist.' };
  }

  // Clerk has served this list both bare and wrapped in `data` across
  // versions, so both are read rather than one being assumed.
  //
  // The object check is not decoration: `JSON.parse('null')` is a successful
  // parse of a 200, and reading `.data` off it throws. That throw would
  // escape to the route, which has already written the invite row, so the
  // operator would get a 500 for a request that half happened rather than
  // the unreadable-answer outcome two lines below.
  const rows = Array.isArray(body)
    ? body
    : typeof body === 'object' &&
        body !== null &&
        Array.isArray((body as { data?: unknown }).data)
      ? (body as { data: unknown[] }).data
      : null;
  if (rows === null) {
    return { ok: false, error: 'Clerk returned an unreadable waitlist.' };
  }

  const wanted = email.trim().toLowerCase();
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const entry = row as WaitlistEntry;
    if (
      typeof entry.email_address !== 'string' ||
      entry.email_address.trim().toLowerCase() !== wanted
    ) {
      continue;
    }
    return {
      ok: true,
      status: typeof entry.status === 'string' ? entry.status : '',
    };
  }
  return { ok: true, status: null };
}

/**
 * Invite this address in Clerk, then report what Clerk says about it.
 *
 * Deliberately best-effort from the caller's point of view: issuing the
 * invite on this deployment must not depend on Clerk answering. A
 * deployment with no `CLERK_SECRET_KEY` is a supported shape, and
 * `worker/index.ts` already carries a note about an earlier version of this
 * where requiring that key for every admin route made the invite routes
 * answer 503 to an operator who was only trying to invite somebody.
 */
export async function admitToClerk(
  env: ClerkWaitlistEnv,
  email: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ClerkAdmission> {
  if (!clerkAdmissionConfigured(env)) {
    return { admitted: false, reason: 'unconfigured' };
  }

  let created = false;
  try {
    const response = await fetchImpl(`${CLERK_API}/invitations`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email_address: email }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    created = response.ok;
    // A refusal is not the end of it. Clerk rejects a duplicate invitation,
    // and somebody who already has one may already be admitted, which the
    // read below settles. What it must not do is decide the answer here.
  } catch {
    return {
      admitted: false,
      reason: 'error',
      error: 'Could not reach Clerk to invite them.',
    };
  }

  const entry = await entryFor(env, email, fetchImpl);
  if (!entry.ok)
    return { admitted: false, reason: 'error', error: entry.error };

  if (entry.status === null) {
    // Nobody by that address is on the waitlist. An invitation still lets
    // them sign up, so a created one admits them; without one there is
    // nothing to show for this at all.
    return created
      ? { admitted: true, via: 'invitation' }
      : {
          admitted: false,
          reason: 'error',
          error:
            'Clerk would not create an invitation and has no waitlist entry for them.',
        };
  }

  if (ADMITTED.has(entry.status)) return { admitted: true, via: 'waitlist' };

  // The two signals disagree, and which one wins is the thing this module
  // deliberately does not know: Clerk took the invitation, and Clerk still
  // lists this person as not admitted. An invitation may let them sign up
  // anyway, or the waitlist entry may gate them, and Clerk documents
  // neither.
  //
  // So `invited` is carried rather than resolved. Saying they can sign in
  // and saying they cannot are both guesses; what is true under either
  // reading is that somebody should go and look, and the panel says that.
  return {
    admitted: false,
    reason: 'still-waiting',
    status: entry.status,
    invited: created,
  };
}
