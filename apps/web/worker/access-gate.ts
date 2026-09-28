/**
 * Which routes the invite gate stands in front of, and which it does not.
 *
 * A list rather than a check scattered through the handlers, because the
 * failure mode of the scattered version is silent: a new endpoint that spends
 * money and forgets the call is open, and nothing says so. Here a new route
 * has to be classified, and `access-gate.test.ts` reads the router's own
 * source and fails on any path that appears in neither list.
 *
 * "Ungated" never means "unauthenticated", for the browser routes: they all
 * still resolve a principal, and the question this file answers for them is
 * only whether a signed-in caller who has not been invited may proceed.
 *
 * Two entries are not browser routes and do not resolve one, which the
 * sentence above used to deny:
 *
 * - `/api/stripe/webhook` is Stripe's own POST, authenticated by the
 *   signature over the raw body and by nothing else. There is no session.
 * - `/api/github/callback` is a redirect target GitHub sends a browser to.
 *   It carries no secret and grants nothing; the write is behind `/bind`,
 *   which is gated.
 *
 * Worth stating rather than leaving implied, because this comment is what
 * the next route classification will be read against, and a rule with two
 * unmentioned exceptions is a rule somebody will apply to a third.
 */

/**
 * Methods gated on a path, where gating all of them would trap somebody.
 *
 * Revocation is not deletion. An account that loses access still owns what
 * it started, and taking away the means to stop or withdraw that is not a
 * gate, it is a trap: a sandbox nobody can stop, a public link nobody can
 * pull, a repository grant nobody can hand back. Starting new work is what
 * an invite buys, so the creating method stays gated and the undoing one
 * does not.
 */
export const GATED_METHODS: Readonly<Record<string, readonly string[]>> = {
  // POST starts a sandbox and spends time in it. DELETE stops one that is
  // already running, and its owner must always be able to.
  '/api/preview': ['POST'],
  // POST mints a public link to somebody's generated code. DELETE pulls it,
  // and GET lists what is currently exposed. A revoked owner who cannot do
  // either is left with their work public and no way to take it down.
  '/api/preview/share': ['POST'],
  // POST builds a project and puts it on the open web under a name of its
  // own. DELETE takes it off again (ADR-0013).
  //
  // The same rule as the share link above, and the case it applies to
  // hardest: a published site is more public than a share link and outlives
  // the sandbox that made it. Gating the takedown would leave a revoked
  // account's site serving to anybody who has the address, with the owner
  // locked out of the only control that stops it, and no operator route to
  // do it for them. A takedown spends nothing, builds nothing and grants
  // nothing; it only ever makes less public.
  '/api/publish': ['POST'],
  // POST stores a file, which is spending (storage, and a quota an
  // uninvited account has no reason to hold). GET lists the caller's own
  // library and DELETE removes a file from it: a revoked account must still
  // be able to see what it uploaded and take it down.
  '/api/media': ['POST'],
};

/** Routes an uninvited caller must not reach, whatever the method. */
export const GATED_PATHS: readonly string[] = [
  // Spends model budget.
  '/api/plan',
  // Spends model budget too, and less of it is not a different answer: the
  // gate is about whether an uninvited account may spend this deployment's
  // money at all, not about how much (internal issue 185).
  '/api/mockups',
  // Spends model budget on every message, including the ones that only
  // reply. A question is cheaper than a build and is still this
  // deployment's money.
  '/api/chat',
  // Writes into somebody's repository, and mints tokens to do it.
  '/api/github/connect',
  '/api/github/complete',
  '/api/github/bind',
  '/api/github/push',
  // Reads the connected repository with the installation token, and spends
  // the same GitHub quota a push does. It writes nothing, but the grant it
  // uses is the one `/api/github/bind` creates, and bind is gated: an
  // account that may not create the grant may not spend it either.
  '/api/github/diff',
  // Takes money, which an uninvited account has no reason to be able to do.
  '/api/billing/checkout',
  // Saves a card, and the card is what the welcome credit is paid on. It
  // also creates a Stripe customer, which is what `/api/billing/portal`
  // below relies on an uninvited account never having.
  '/api/billing/card',

  // Issues a referral code, which is a share link into a closed product.
  '/api/referral/status',
  // Records who referred this account. Gated for now, which has a cost worth
  // stating: somebody who arrives on a referral link, signs up and lands on
  // the waiting list cannot record their referrer, and the code is gone from
  // the URL by the time they are let in. Nothing is lost today, because the
  // referral programme has no interface and its reward is a placeholder.
  //
  // Opening it would be defensible: a claim spends nothing and grants
  // nothing, and no payout is possible until a purchase clears, which an
  // uninvited account cannot make. The cost of opening it is that an
  // uninvited account can write a row. That is a product decision about how
  // an invite-only launch and a referral programme should interact, so it
  // stays closed until somebody makes it rather than being decided by
  // whichever default I typed first.
  '/api/referral/claim',
];

/**
 * Routes that stay open to a signed-in caller who has not been invited, each
 * with the reason it has to.
 */
export const UNGATED_PATHS: Readonly<Record<string, string>> = {
  // The shell asks this before it can render anything, including the screen
  // that tells somebody they are not on the list.
  '/api/config': 'the shell cannot render the refusal without it',
  '/api/access/status': 'this is the endpoint that reports the refusal',
  // A readout of the caller's own balance. Hiding it would leave somebody
  // who was invited, spent, and then had access revoked with no way to see
  // what happened to their money.
  //
  // It is not quite read-only, and saying so here was wrong: it used to
  // grant the sign-up credit on first read, and now it opens the offer of
  // it, which is what a saved card is later paid against. That write is
  // behind the access decision inside the handler, because an ungated
  // route that leads to the $1 is the one thing this gate exists to
  // prevent. A route listed here has to be read-only in fact, not in
  // description.
  '/api/billing/status': 'a balance read, with its one write behind the gate',
  // A read of what this caller's own runs did. Same reason as the balance
  // above: somebody who was invited, generated, and then had access revoked
  // can still see what became of the runs they paid for. It grants nothing
  // and starts nothing, and it is read-only in fact as well as in
  // description -- the writes happen in the Workflow, behind `/api/plan`,
  // which stays gated.
  '/api/runs': "a read of the caller's own run history",
  // Revocation does not cancel a subscription in Stripe, and this and
  // `/api/billing/cancel` below are the only ways to cancel one. Gating it
  // would take a customer's access away while their card kept being
  // charged and leave them no way to stop it, in the product or out of it.
  // That is not a gate, it is a trap.
  //
  // Safe to leave open because it grants nothing: it needs an existing
  // Stripe customer and errors without one, and the only routes that create
  // a customer are `/api/billing/checkout` and `/api/billing/card`, which
  // stay gated. So an uninvited account finds nothing here.
  '/api/billing/portal': 'the only way to stop being charged',
  // The same cancellation, opened directly and with the retention offer for
  // a monthly plan. Open for the portal's reason: a route that stops
  // charges must not be one a revoked account is refused.
  //
  // The offer is the part worth checking, since a discount is something
  // granted. An uninvited account never reaches it, because it has no
  // subscription (checkout is gated). A revoked one normally does not
  // either: the revoke schedules the subscription's end itself
  // (`access-billing.ts`), and a subscription already ending is sent to the
  // plain portal rather than the offer. The exception is a revoke whose
  // wind-down failed, which the operator who revoked is shown as failed.
  '/api/billing/cancel': 'stopping charges, like the portal',
  // Withdrawing a grant this account already made. It writes nothing to
  // GitHub and mints no token; it only takes back what was given. Gating it
  // left a revoked account able to see its binding through the status route
  // and unable to remove it, which is the wrong way round.
  '/api/github/disconnect': 'withdrawing a grant, not making one',
  // Stripe's own POST, authenticated by signature rather than by session.
  // Gating it would mean dropping webhooks for uninvited accounts, which is
  // how a payment that succeeded ends up unmirrored.
  '/api/stripe/webhook': 'Stripe is the caller, and it has no invite',
  // GitHub redirects the browser here after an installation. It carries no
  // secret and grants nothing on its own; the write is behind /bind.
  '/api/github/callback': 'an unauthenticated redirect target, not a grant',
  // GitHub's own POST, authenticated by an HMAC over the raw body and by
  // nothing else. There is no session to gate: the delivery is about a pull
  // request in a repository somebody already connected, and gating it would
  // mean dropping deliveries for accounts whose access lapsed, which is how
  // a merged pull request goes on being shown as open forever.
  '/api/github/webhook': 'GitHub is the caller, and it has no invite',
  // A read of what is already connected. Answering it for an uninvited
  // account tells them nothing they did not already do.
  '/api/github/status': "a read-only view of the caller's own binding",
  // Deleting the account (docs/decisions.md L32), asking where that stands,
  // and taking it back within the 30 days. The same rule as the wind-down
  // routes above, at its strongest: an account that was never invited, or
  // whose invite was withdrawn, still has personal data here and a right
  // to have it deleted, and gating this would leave it no way to ask. It
  // spends nothing and grants nothing; everything it does is stopping,
  // taking down and deleting.
  '/api/account/delete': 'leaving is not something an invite buys',
  '/api/account/delete/cancel':
    'keeping an account already made, which grants nothing new',
  // Already behind the stricter platform-admin check, which an invite does
  // not confer and which an admin passes without one.
  '/api/admin/deletions': 'behind the platform-admin check instead',
  '/api/admin/user': 'behind the platform-admin check instead',
  '/api/admin/topup': 'behind the platform-admin check instead',
  '/api/admin/suspension/lift': 'behind the platform-admin check instead',
  '/api/admin/unattributed': 'behind the platform-admin check instead',
  '/api/admin/invites': 'behind the platform-admin check instead',
  '/api/admin/invite': 'behind the platform-admin check instead',
  '/api/admin/invite/revoke': 'behind the platform-admin check instead',
  // Taking somebody else's published site off the web (internal issue 172). Behind the
  // platform-admin check, which an invite does not confer and an admin
  // passes without one -- and this is the control an abuse report is
  // answered through, so it must not depend on the operator's own invite
  // being current.
  '/api/admin/publish/hold': 'behind the platform-admin check instead',
  '/api/admin/publish/release': 'behind the platform-admin check instead',
};

export function isGated(pathname: string, method: string): boolean {
  if (GATED_PATHS.includes(pathname)) return true;
  const gatedMethods = GATED_METHODS[pathname];
  return gatedMethods ? gatedMethods.includes(method.toUpperCase()) : false;
}
