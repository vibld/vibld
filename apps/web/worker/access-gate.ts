/**
 * Which routes the invite gate stands in front of, and which it does not.
 *
 * A list rather than a check scattered through the handlers, because the
 * failure mode of the scattered version is silent: a new endpoint that spends
 * money and forgets the call is open, and nothing says so. Here a new route
 * has to be classified, and `access-gate.test.ts` reads the router's own
 * source and fails on any path that appears in neither list.
 *
 * "Ungated" never means "unauthenticated". Everything below still resolves a
 * principal; the question this file answers is only whether a signed-in
 * caller who has not been invited may proceed.
 */

/** Routes an uninvited caller must not reach. */
export const GATED_PATHS: readonly string[] = [
  // Spends model budget.
  '/api/plan',
  // Spends sandbox time and runs generated code.
  '/api/preview',
  '/api/preview/share',
  // Builds and serves a project on Vibld infrastructure.
  '/api/publish',
  // Writes into somebody's repository, and mints tokens to do it.
  '/api/github/connect',
  '/api/github/complete',
  '/api/github/bind',
  '/api/github/disconnect',
  '/api/github/push',
  // Takes money, which an uninvited account has no reason to be able to do.
  '/api/billing/checkout',
  '/api/billing/portal',
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
  // It is not quite read-only, and saying so here was wrong: it grants the
  // sign-up credit on first read. That grant is now behind the access
  // decision inside the handler, because an ungated route that hands out
  // the $1 is the one thing this gate exists to prevent. A route listed
  // here has to be read-only in fact, not in description.
  '/api/billing/status': 'a balance read, with its one write behind the gate',
  // Stripe's own POST, authenticated by signature rather than by session.
  // Gating it would mean dropping webhooks for uninvited accounts, which is
  // how a payment that succeeded ends up unmirrored.
  '/api/stripe/webhook': 'Stripe is the caller, and it has no invite',
  // GitHub redirects the browser here after an installation. It carries no
  // secret and grants nothing on its own; the write is behind /bind.
  '/api/github/callback': 'an unauthenticated redirect target, not a grant',
  // A read of what is already connected. Answering it for an uninvited
  // account tells them nothing they did not already do.
  '/api/github/status': "a read-only view of the caller's own binding",
  // Already behind the stricter platform-admin check, which an invite does
  // not confer and which an admin passes without one.
  '/api/admin/user': 'behind the platform-admin check instead',
  '/api/admin/topup': 'behind the platform-admin check instead',
  '/api/admin/invites': 'behind the platform-admin check instead',
  '/api/admin/invite': 'behind the platform-admin check instead',
  '/api/admin/invite/revoke': 'behind the platform-admin check instead',
};

export function isGated(pathname: string): boolean {
  return GATED_PATHS.includes(pathname);
}
