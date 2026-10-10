import {
  PROJECT_DOMAIN_ROUTE,
  projectIdInPath,
  routeKeyFor,
} from './access-gate.ts';
import {
  CustomDomainStore,
  CustomHostnames,
  customHostnameTarget,
  dohResolveTxt,
  ownershipRecord,
  customHostnamesConfigured,
  normalizeHostname,
} from './custom-domain.ts';
import type {
  CustomHostnameEnv,
  CustomHostnameState,
  DnsRecord,
  ResolveTxt,
  DomainStatus,
} from './custom-domain.ts';
import type { Tier } from './entitlement.ts';
import type { PrincipalDenied, PrincipalGranted } from './principal.ts';
import { ProjectStore } from './project-store.ts';
import { checkRequestOrigin, isProjectId } from './request-guard.ts';

/**
 * A published site's own domain (docs/decisions.md D189), on the project's
 * own route:
 *
 *     GET    /api/projects/:id/domain   the domain and where it stands
 *     POST   /api/projects/:id/domain   connect one, {hostname}
 *     DELETE /api/projects/:id/domain   disconnect it
 *
 * The project has to be the caller's and published, and the account on a
 * paid plan (D189: "for paid plans"). A deployment that sells no plans
 * has no tier to ask about (`tierOf` answers null), and there every
 * account may connect one.
 *
 * Whether the domain works is Cloudflare's to say, so GET asks it each
 * time rather than keeping a copy that would go stale. `DOMAIN_BURST`
 * bounds how often one account can make it ask.
 */

export const PAID_PLAN_CODE = 'paid-plan-required';

/** The refusal that carries the TXT record proving the domain is the caller's. */
export const OWNERSHIP_CODE = 'verify-ownership';

export interface DomainEnv extends CustomHostnameEnv {
  DB?: D1Database;
  PROJECT_CONTENT?: R2Bucket;
  DOMAIN_BURST?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
}

export interface DomainDeps {
  resolvePrincipal: (
    request: Request,
  ) => Promise<PrincipalDenied | PrincipalGranted>;
  /** The caller's tier, or null where this deployment sells no plans. */
  tierOf: (userId: string) => Promise<Tier | null>;
  fetchImpl?: typeof fetch;
  /** TXT lookups for the ownership proof. Defaults to DNS over HTTPS. */
  resolveTxt?: ResolveTxt;
  now?: () => Date;
}

/** What the builder is told about a project's domain. */
export interface DomainView {
  hostname: string;
  status: DomainStatus;
  /** Every record the owner needs: the CNAME first, then any checks. */
  records: DnsRecord[];
  errors: string[];
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function viewOf(
  hostname: string,
  target: string,
  state: CustomHostnameState | null,
): DomainView {
  const cname: DnsRecord = { type: 'CNAME', name: hostname, value: target };
  if (!state) {
    return {
      hostname,
      status: 'pending',
      records: [cname],
      errors: ['Where this domain stands could not be read just now.'],
    };
  }
  return {
    hostname,
    status: state.status,
    records: [cname, ...state.records],
    errors: state.errors,
  };
}

const ALLOWED = ['GET', 'POST', 'DELETE'];

export async function handleProjectDomain(
  request: Request,
  env: DomainEnv,
  deps: DomainDeps,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (routeKeyFor(pathname) !== PROJECT_DOMAIN_ROUTE) {
    return json({ error: 'Not found.' }, 404);
  }
  const method = request.method.toUpperCase();
  if (!ALLOWED.includes(method)) {
    return json({ error: `Use ${ALLOWED.join(', ')}.` }, 405);
  }
  const projectId = projectIdInPath(pathname);
  if (!isProjectId(projectId)) return json({ error: 'Not found.' }, 404);

  // Shape before identity, as every project write is (`project-handlers.ts`).
  if (method === 'POST') {
    const origin = checkRequestOrigin(
      request.headers,
      new URL(request.url).origin,
    );
    if (!origin.ok) return json({ error: origin.error }, origin.status);
  } else if (method === 'DELETE') {
    const origin = request.headers.get('origin');
    if (origin !== null && origin !== new URL(request.url).origin) {
      return json({ error: 'Cross-site requests are not allowed.' }, 403);
    }
  }

  if (!env.DB || !env.PROJECT_CONTENT) {
    return json(
      { error: 'Projects are not configured for this deployment.' },
      503,
    );
  }
  const target = customHostnameTarget(env);
  if (!customHostnamesConfigured(env)) {
    return method === 'GET'
      ? json({ configured: false, target, domain: null })
      : json(
          { error: 'Custom domains are not configured for this deployment.' },
          503,
        );
  }

  const resolved = await deps.resolvePrincipal(request);
  if (resolved.denied) return resolved.denied;
  const { userId } = resolved.principal;

  if (env.DOMAIN_BURST) {
    try {
      const limited = await env.DOMAIN_BURST.limit({ key: `domain:${userId}` });
      if (!limited.success) {
        return json(
          { error: 'Too many domain requests. Try again shortly.' },
          429,
        );
      }
    } catch (error) {
      console.error('domain rate limiter unavailable', error);
    }
  }

  const project = await new ProjectStore(env.DB, env.PROJECT_CONTENT).find(
    userId,
    projectId,
  );
  if (!project) return json({ error: 'Not found.' }, 404);

  const domains = new CustomDomainStore(env.DB);
  const cloudflare = new CustomHostnames(
    env.CUSTOM_HOSTNAME_ZONE_ID!,
    env.CUSTOM_HOSTNAME_API_TOKEN!,
    deps.fetchImpl,
  );
  const existing = await domains.forProject(projectId);

  if (method === 'GET') {
    const tier = await deps.tierOf(userId);
    const eligible = tier === null || tier !== 'free';
    if (!existing) {
      return json({ configured: true, eligible, target, domain: null });
    }
    let state = await cloudflare.get(existing.cloudflareId);
    // The builder's "Check again" (`?recheck=1`) also restarts validation
    // of a hostname not active yet: one still pending, which its CNAME
    // added since needs, or one whose validation timed out before it was.
    if (
      state.ok &&
      state.value.status !== 'active' &&
      new URL(request.url).searchParams.get('recheck') === '1'
    ) {
      const rechecked = await cloudflare.recheck(existing.cloudflareId);
      if (rechecked.ok) state = rechecked;
      else console.error('custom hostname recheck failed', rechecked.error);
    }
    return json({
      configured: true,
      eligible,
      target,
      domain: viewOf(existing.hostname, target, state.ok ? state.value : null),
    });
  }

  if (method === 'DELETE') {
    if (!existing) {
      return json({ error: 'This project has no domain.' }, 404);
    }
    const removed = await cloudflare.remove(existing.cloudflareId);
    if (!removed.ok) {
      console.error('custom hostname removal failed', removed.error);
      return json(
        { error: 'The domain could not be disconnected. Try again shortly.' },
        502,
      );
    }
    await domains.remove(projectId, existing.cloudflareId);
    return json({ hostname: existing.hostname });
  }

  // POST: connect one.
  const tier = await deps.tierOf(userId);
  if (tier === 'free') {
    return json(
      {
        error: 'Custom domains come with the Build and Ship plans.',
        code: PAID_PLAN_CODE,
      },
      402,
    );
  }
  if (!project.site || project.site.state !== 'live') {
    return json(
      { error: 'Publish the project first, then connect a domain to it.' },
      409,
    );
  }
  if (existing) {
    return json(
      {
        error: `This project is already connected to ${existing.hostname}. Disconnect it first.`,
      },
      409,
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be valid JSON.' }, 400);
  }
  const checked = normalizeHostname(
    ((body ?? {}) as { hostname?: unknown }).hostname,
  );
  if (!checked.ok) return json({ error: checked.error }, 400);
  const { hostname } = checked;

  // Proof that this account controls the domain, before anything is
  // registered in its name (`ownershipRecord`).
  const proof = await ownershipRecord(userId, hostname);
  const found = await (deps.resolveTxt ?? dohResolveTxt())(proof.name);
  if (found === null) {
    return json(
      { error: `${hostname}'s DNS could not be checked. Try again shortly.` },
      502,
    );
  }
  if (!found.includes(proof.value)) {
    return json(
      {
        error: `Add this TXT record at ${hostname}'s DNS provider to show the domain is yours, then connect again. It can take a few minutes to be seen.`,
        code: OWNERSHIP_CODE,
        record: proof,
      },
      409,
    );
  }

  const made = await cloudflare.create(hostname);
  if (!made.ok) {
    if (made.duplicate) {
      return json(
        { error: `${hostname} is already connected to a site.` },
        409,
      );
    }
    console.error('custom hostname creation failed', made.error);
    return json(
      { error: 'The domain could not be connected. Try again shortly.' },
      502,
    );
  }
  const now = (deps.now ?? (() => new Date()))().toISOString();
  let added: boolean;
  try {
    added = await domains.add(
      { hostname, projectId, userId, cloudflareId: made.value.id },
      now,
    );
  } catch (error) {
    // Without its row the hostname has no owner here to disconnect it, so
    // it goes at Cloudflare too, and the owner can simply try again.
    console.error('custom domain row write failed', error);
    await cloudflare.remove(made.value.id);
    return json(
      { error: 'The domain could not be connected. Try again shortly.' },
      502,
    );
  }
  if (!added) {
    // Another request took the hostname or gave this project a domain in
    // between, or the project was deleted while Cloudflare was asked
    // (`CustomDomainStore.add` writes only for a project that still
    // exists). The custom hostname this one made is nobody's, so it goes.
    await cloudflare.remove(made.value.id);
    return json({ error: `${hostname} is already connected to a site.` }, 409);
  }
  return json(
    {
      configured: true,
      eligible: true,
      target,
      domain: viewOf(hostname, target, made.value),
    },
    201,
  );
}

/**
 * Disconnect a project's domain, for the project's deletion
 * (`project-handlers.ts`). True once there is none: nothing was connected,
 * or Cloudflare removed it and then the row went. False keeps the row,
 * the only record of the hostname's id at Cloudflare, so the owner can
 * try the deletion again rather than leave a hostname registered that
 * nobody can connect again.
 */
export async function removeProjectDomain(
  env: DomainEnv,
  projectId: string,
  fetchImpl?: typeof fetch,
): Promise<boolean> {
  if (!env.DB) return true;
  const domains = new CustomDomainStore(env.DB);
  const existing = await domains.forProject(projectId);
  if (!existing) return true;
  // A deployment whose token was taken off after domains were connected
  // keeps the project, and with it the owner's way back to this domain,
  // until there is a token to remove the hostname with.
  if (!customHostnamesConfigured(env)) {
    console.error('custom hostname removal: no CUSTOM_HOSTNAME_API_TOKEN');
    return false;
  }
  const removed = await new CustomHostnames(
    env.CUSTOM_HOSTNAME_ZONE_ID!,
    env.CUSTOM_HOSTNAME_API_TOKEN!,
    fetchImpl,
  ).remove(existing.cloudflareId);
  if (!removed.ok) {
    console.error('custom hostname removal failed', removed.error);
    return false;
  }
  await domains.remove(projectId, existing.cloudflareId);
  return true;
}

/**
 * Rows one night's plan check looks at (`sweepLapsedDomains`). Its own
 * invocation's D1 queries, at most 1 + 3 a row, stay inside the Workers
 * Paid plan's 1,000 (this Worker sets `limits.cpu_ms`, which only that plan
 * has), and its Cloudflare calls, at most one a row, inside the
 * subrequest limit. Every row comes round again within (domains / 300)
 * nights.
 */
export const DOMAINS_CHECKED_PER_NIGHT = 300;

/**
 * Disconnect the domains of accounts whose plan no longer has them (D189,
 * Chris on the decision card, 2026-10-10): a subscription that ended or
 * stopped being paid, or a gift that ran out. Connecting is refused on
 * Free; this is the same rule for a domain connected before the plan
 * ended. The vibld address keeps working, and resubscribing lets the
 * owner connect it again. And any domain whose project is gone, left by
 * a deletion whose own removal failed at Cloudflare, whatever the plan.
 *
 * A bounded batch a night, the least recently checked first (a new row
 * counts as checked when it was connected), so the pass costs no more
 * however many domains there are and every row comes round in turn: one
 * read, then for each
 * row the plan (`tierOf`, two queries) and either the mark that it was
 * checked or the removal. Its own Cron Trigger, so its D1 queries are not
 * the billing pass's allowance. A Cloudflare failure keeps the row, which
 * comes round again.
 */
export async function sweepLapsedDomains(
  env: DomainEnv,
  deps: {
    tierOf: (userId: string) => Promise<Tier | null>;
    fetchImpl?: typeof fetch;
    now?: () => Date;
  },
  limit = DOMAINS_CHECKED_PER_NIGHT,
): Promise<{ checked: number; removed: number; failed: number }> {
  const outcome = { checked: 0, removed: 0, failed: 0 };
  if (!env.DB || !customHostnamesConfigured(env)) return outcome;
  const domains = new CustomDomainStore(env.DB);
  const cloudflare = new CustomHostnames(
    env.CUSTOM_HOSTNAME_ZONE_ID!,
    env.CUSTOM_HOSTNAME_API_TOKEN!,
    deps.fetchImpl,
  );
  const now = (deps.now ?? (() => new Date()))().toISOString();
  for (const row of await domains.dueForCheck(limit)) {
    outcome.checked += 1;
    if (!row.orphaned && (await deps.tierOf(row.userId)) !== 'free') {
      await domains.markChecked(row.hostname, now);
      continue;
    }
    const removed = await cloudflare.remove(row.cloudflareId);
    if (!removed.ok) {
      console.error('lapsed custom domain removal failed', removed.error);
      outcome.failed += 1;
      // Behind the others for tomorrow, rather than first again.
      await domains.markChecked(row.hostname, now);
      continue;
    }
    await domains.remove(row.projectId, row.cloudflareId);
    outcome.removed += 1;
  }
  return outcome;
}
