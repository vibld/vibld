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
 * And a share link's two public routes, `/api/share/:token` and its
 * `/preview`, are browser routes that resolve no principal to be read, on
 * purpose: the token in the path is the grant, given out by an owner who
 * was invited when they gave it. Starting the preview is the exception and
 * does resolve one. Their entries below say why each is safe open.
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
  // POST starts a sandbox and spends time in it. PATCH writes a new
  // revision into a running one and may install packages in it (D74),
  // which is new work in the same sandbox. DELETE stops one that is
  // already running, and its owner must always be able to.
  '/api/preview': ['POST', 'PATCH'],
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
  // POST makes a project, which is starting new work and storage an
  // uninvited account has no reason to hold. GET lists the caller's own,
  // which a revoked account must still be able to see: the projects are
  // what it made while it was invited, and a list it cannot open reads as
  // the work being taken away.
  '/api/projects': ['POST'],
  // Copies a project's code and conversation into a new one: storage, and
  // a new project, for the reason POST on `/api/projects` is gated.
  '/api/projects/:id/duplicate': ['POST'],
  // POST turns a project's share link on, which puts somebody's generated
  // code in front of anybody holding the link, and lets them start a live
  // preview of it (`share-handlers.ts`): new exposure, and new sandbox time
  // on this deployment's containers. DELETE turns it off again, and is
  // open for the reason DELETE on `/api/preview/share` is: a revoked owner
  // who could not pull their own link would be left with their work in
  // front of strangers and no control that stops it.
  '/api/projects/:id/share': ['POST'],
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
  // Copies somebody's shared project into the caller's account: a new
  // project, its code and its media in storage the caller then holds. The
  // same act as duplicating one's own project, which is gated, pointed at
  // somebody else's. An uninvited account that follows a link still sees
  // the project (`/api/share/:token` below); making it theirs is starting
  // new work, which is what an invite buys.
  '/api/share/:token/remix',
  // Takes money, which an uninvited account has no reason to be able to do.
  '/api/billing/checkout',
  // Saves a card, and the card is what the welcome credit is paid on. It
  // also creates a Stripe customer, which is what `/api/billing/portal`
  // below relies on an uninvited account never having.
  '/api/billing/card',
  // Turns on charging a saved card without the person there (D166), which
  // is taking money as checkout is.
  '/api/billing/auto-reload',

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
  // The style gallery (D142): part of what an invite buys, as the builder
  // is. Its data is public (D143); this route spends nothing.
  '/api/style-gallery',
  // A design template's brief for the builder (D148). The briefs are public
  // on vibld.com already; this is gated as the builder is. It spends nothing.
  '/api/templates/brief',
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
  // Starting a paid plan on a saved card without the person there (D167).
  // Turning it on is taking money as checkout is, and is behind the access
  // decision inside the handler. Turning it off is open: an account whose
  // invite was withdrawn must still be able to take back that standing
  // permission, or a later restore would start the plan before it could.
  '/api/billing/auto-subscribe':
    'turning it off; turning it on is behind the gate in the handler',
  // A read of what this caller's own runs did. Same reason as the balance
  // above: somebody who was invited, generated, and then had access revoked
  // can still see what became of the runs they paid for. It grants nothing
  // and starts nothing, and it is read-only in fact as well as in
  // description -- the writes happen in the Workflow, behind `/api/plan`,
  // which stays gated.
  '/api/runs': "a read of the caller's own run history",
  // One file of the caller's own media library, for the in-browser preview
  // (D125). A read, like GET on `/api/media`, which lists the same library:
  // a revoked account can still see what it uploaded, and the preview it
  // feeds runs in the caller's browser and spends nothing here.
  '/api/media/file': "one file of the caller's own media library",
  // One of the caller's own builds: what became of it (GET), and stopping
  // it (DELETE), which is the only thing that stops one now that a build
  // outlives the page that started it (docs/decisions.md, "Resolved
  // 2026-09-29", keep building). Open for the rule `GATED_METHODS` opens
  // with: an account that loses its invite mid-build still owns the build,
  // and taking away its Stop would leave it running and billed with no
  // way to end it. Neither method starts or spends anything; the build it
  // names was started through `/api/plan`, which stays gated.
  '/api/runs/:id': "the caller's own build: ask after it or stop it",
  // One of the caller's own projects: open it (GET), rename, archive,
  // unarchive or save its settings and conversation (PATCH), or delete it
  // (DELETE). The same rule as the media library and the published site:
  // revocation is not deletion, and an account that lost its invite still
  // owns what it made, so it can still read it, tidy it and take it away.
  //
  // None of it spends. Opening reads what is stored; a save rewrites one
  // bounded object the project already has, and there is nothing to save
  // for an account that was never invited, since every route that would
  // have produced a conversation or code is gated. Unarchiving is held to
  // the free tier's limit like creating is, so it is not a way around it.
  // The routes that do start work in a project (`/api/plan`, `/api/chat`)
  // stay gated, and that is where an invite is spent.
  '/api/projects/:id': "the caller's own project: read, tidy or delete it",
  // A project's accepted checkpoints (GET), and making an earlier one the
  // accepted one again (POST on `/restore`) (D152). Open for the reason
  // the project itself is: the history is part of what the account made,
  // and putting back code it already had is tidying it, like a save. It
  // spends nothing: no model, no sandbox, no budget and no new storage,
  // since the restored revision is already stored and only the pointer to
  // it moves. Nothing is published or pushed by it either; the routes
  // that do that stay where they are.
  '/api/projects/:id/checkpoints': "a read of the caller's own project history",
  '/api/projects/:id/checkpoints/restore':
    "putting back code the caller's own project already had",
  // A shared project, as the stranger its owner sent the link to sees it:
  // its name and its accepted code, read-only. Not gated, and not
  // authenticated either, which makes it the third entry here that
  // resolves no principal, after the two webhooks-and-redirects named at
  // the top of this file. It has to be: the link is how an owner shows
  // their work to somebody who may have no account at all, and a link that
  // demanded an invite would only ever reach people who could already see
  // it some other way.
  //
  // Safe to leave open because the token is the whole of the grant, and it
  // is the owner's to give: 256 random bits, minted only by an invited
  // owner (POST on `/api/projects/:id/share` is gated), forgotten when they
  // turn it off, and refused whenever the project is archived, deleted or
  // held, or its owner is suspended or leaving (`ProjectStore.findShared`).
  // It is read-only in fact: it writes nothing, and it reveals nothing about
  // the owner. Every request is counted against the caller's address before
  // the database is read (`SHARE_BURST`).
  '/api/share/:token':
    'a public link its owner chose to give out; the token is the grant',
  // The shared project's live preview: its state (GET), and starting it
  // (POST). The one route here that is not read-only, and the reason is
  // worth stating rather than hiding behind the entry above. Starting it
  // spends sandbox time, and spending is what the gate exists to guard.
  //
  // Starting it needs a signed-in account (docs/decisions.md, 2026-09-28):
  // the handler resolves a principal before it starts anything, refuses an
  // account that is suspended or leaving, and counts starts per account
  // (`SHARE_PREVIEW_BURST`) as well as per address. Signed in, because a
  // sandbox is the one thing a link lets a stranger spend, and an account is
  // something a start can be counted against, refused, and traced to if a
  // link is used to keep containers busy; an address is none of those.
  // Reading its state stays open to anybody holding the link, like the view,
  // and a stranger who is not signed in can still watch a preview somebody
  // else started.
  //
  // Not behind the invite, though, and that is the decision this entry is
  // for. The spending is the owner's: they turned the link on behind the
  // gate, and it is bounded by the link rather than by who opens it: one
  // sandbox per link however many people do (`sharePreviewKey`), the
  // preview's usual lifetime, the same container budget every preview
  // queues in, and no model spend. A viewer who was never invited can start,
  // at most, what the owner could have started for them, and demanding an
  // invite of the people an owner shows their work to would make the link
  // useful only to those who could already build.
  '/api/share/:token/preview':
    "the owner's shared preview: starting it needs an account, not an invite",
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
  // The same, for every project's grant and the sign-in at once (D72). The
  // locked-out account screen offers it, so a revoked account can take back
  // every GitHub grant it made without being let back in.
  '/api/github/disconnect-account': 'withdrawing every grant, not making one',
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
  // Signing in with the owner's password on a copy that uses it (D123). It
  // is how a caller gets an identity, so it cannot ask for one, and there
  // is nobody but the owner to invite. It grants a session only for the
  // right password, counts attempts per address, and answers 404 on any
  // deployment signed in some other way.
  '/api/owner/session': 'signing in, which comes before any identity',
  // Already behind the stricter platform-admin check, which an invite does
  // not confer and which an admin passes without one.
  '/api/admin/deletions': 'behind the platform-admin check instead',
  '/api/admin/user': 'behind the platform-admin check instead',
  '/api/admin/topup': 'behind the platform-admin check instead',
  '/api/admin/suspension/lift': 'behind the platform-admin check instead',
  '/api/admin/unattributed': 'behind the platform-admin check instead',
  '/api/admin/accounts': 'behind the platform-admin check instead',
  '/api/admin/accounts/import': 'behind the platform-admin check instead',
  '/api/admin/admins': 'behind the platform-admin check instead',
  '/api/admin/overview': 'behind the platform-admin check instead',
  '/api/admin/keys': 'behind the platform-admin check instead',
  '/api/admin/keys/remove': 'behind the platform-admin check instead',
  '/api/admin/plans': 'behind the platform-admin check instead',
  '/api/admin/plans/reset': 'behind the platform-admin check instead',
  '/api/admin/models': 'behind the platform-admin check instead',
  '/api/admin/models/reset': 'behind the platform-admin check instead',
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
  '/api/admin/user/detail': 'behind the platform-admin check instead',
  '/api/admin/user/gift': 'behind the platform-admin check instead',
  '/api/admin/user/gift/revoke': 'behind the platform-admin check instead',
  '/api/admin/user/overrides': 'behind the platform-admin check instead',
  '/api/admin/user/models': 'behind the platform-admin check instead',
  '/api/admin/user/ban': 'behind the platform-admin check instead',
  '/api/admin/user/unban': 'behind the platform-admin check instead',
  '/api/admin/user/delete': 'behind the platform-admin check instead',
  '/api/admin/user/stop-builds': 'behind the platform-admin check instead',
  '/api/admin/audit': 'behind the platform-admin check instead',
};

/**
 * The routes with an id in the path, by the name the lists above use.
 *
 * Every other route is one fixed path, which is what lets the lists be
 * plain strings and the test read the router's own `pathname === '...'`
 * comparisons. A project's routes carry its id, so the router turns the
 * path it was given into one of these names first (`routeKeyFor`) and
 * compares against that, and both the gate and the test see a fixed string
 * again. A path that only resembles one (an empty id, or one more segment)
 * is left as it was, so it matches nothing and is answered 404.
 */
export const PROJECT_ITEM_ROUTE = '/api/projects/:id';
export const PROJECT_DUPLICATE_ROUTE = '/api/projects/:id/duplicate';
export const PROJECT_SHARE_ROUTE = '/api/projects/:id/share';
/** A project's accepted checkpoints, and restoring one (D152). */
export const PROJECT_CHECKPOINTS_ROUTE = '/api/projects/:id/checkpoints';
export const PROJECT_RESTORE_ROUTE = '/api/projects/:id/checkpoints/restore';
/**
 * A share link's routes carry its token rather than a project id, and are
 * named the same way for the same reason (`share-handlers.ts`).
 */
export const SHARE_VIEW_ROUTE = '/api/share/:token';
export const SHARE_PREVIEW_ROUTE = '/api/share/:token/preview';
export const SHARE_REMIX_ROUTE = '/api/share/:token/remix';
/** One build, by its Workflow instance id (`run-control.ts`). */
export const RUN_ITEM_ROUTE = '/api/runs/:id';

const PROJECT_ITEM = /^\/api\/projects\/([^/]+)$/;
const PROJECT_DUPLICATE = /^\/api\/projects\/([^/]+)\/duplicate$/;
const PROJECT_SHARE = /^\/api\/projects\/([^/]+)\/share$/;
const PROJECT_CHECKPOINTS = /^\/api\/projects\/([^/]+)\/checkpoints$/;
const PROJECT_RESTORE = /^\/api\/projects\/([^/]+)\/checkpoints\/restore$/;
const SHARE_VIEW = /^\/api\/share\/([^/]+)$/;
const SHARE_PREVIEW = /^\/api\/share\/([^/]+)\/preview$/;
const SHARE_REMIX = /^\/api\/share\/([^/]+)\/remix$/;
const RUN_ITEM = /^\/api\/runs\/([^/]+)$/;

export function routeKeyFor(pathname: string): string {
  if (PROJECT_DUPLICATE.test(pathname)) return PROJECT_DUPLICATE_ROUTE;
  if (PROJECT_SHARE.test(pathname)) return PROJECT_SHARE_ROUTE;
  if (PROJECT_CHECKPOINTS.test(pathname)) return PROJECT_CHECKPOINTS_ROUTE;
  if (PROJECT_RESTORE.test(pathname)) return PROJECT_RESTORE_ROUTE;
  if (PROJECT_ITEM.test(pathname)) return PROJECT_ITEM_ROUTE;
  if (SHARE_PREVIEW.test(pathname)) return SHARE_PREVIEW_ROUTE;
  if (SHARE_REMIX.test(pathname)) return SHARE_REMIX_ROUTE;
  if (SHARE_VIEW.test(pathname)) return SHARE_VIEW_ROUTE;
  if (RUN_ITEM.test(pathname)) return RUN_ITEM_ROUTE;
  return pathname;
}

function segment(match: RegExpExecArray | null): string | null {
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

/** The id in a project route's path, still to be checked for shape. */
export function projectIdInPath(pathname: string): string | null {
  return segment(
    PROJECT_DUPLICATE.exec(pathname) ??
      PROJECT_SHARE.exec(pathname) ??
      PROJECT_CHECKPOINTS.exec(pathname) ??
      PROJECT_RESTORE.exec(pathname) ??
      PROJECT_ITEM.exec(pathname),
  );
}

/** The token in a share route's path, still to be checked for shape. */
export function shareTokenInPath(pathname: string): string | null {
  return segment(
    SHARE_PREVIEW.exec(pathname) ??
      SHARE_REMIX.exec(pathname) ??
      SHARE_VIEW.exec(pathname),
  );
}

/** The id in a run route's path, still to be checked for shape. */
export function runIdInPath(pathname: string): string | null {
  return segment(RUN_ITEM.exec(pathname));
}

export function isGated(pathname: string, method: string): boolean {
  // Named here as well as by the router, so a caller that passes the path
  // as it arrived cannot slip a project route past the lists above.
  const route = routeKeyFor(pathname);
  if (GATED_PATHS.includes(route)) return true;
  const gatedMethods = GATED_METHODS[route];
  return gatedMethods ? gatedMethods.includes(method.toUpperCase()) : false;
}
