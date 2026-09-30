import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, SITE, metaFor } from '../site';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'deploying')!;
const CHECKED = '2026-09-30';

export function meta() {
  return metaFor('/docs/deploying');
}

export default function Deploying() {
  return (
    <DocPage guide={GUIDE} updated={CHECKED}>
      <p>
        From a clone to a running builder. The repository’s own READMEs carry
        the exact commands and stay with the code, so they are the version to
        follow; this page is the shape of the job and the parts that bite.
        Nobody outside the project has followed it end to end yet, so treat it
        as a map that has not been walked.
      </p>
      <p>
        The deploy workflows in the repository run only in the maintainers’ own
        repository, since a copy has none of their secrets. Deploy from your own
        machine with <code>wrangler</code>, or write your own workflow.
      </p>

      <h2>Your copy’s configuration</h2>
      <p>
        The configuration in the repository deploys vibld’s own service: its
        Worker names, its D1 database and R2 bucket, its Workflow, its
        rate-limit namespaces, its domains and its Clerk. Deployed unchanged
        into another account it fails. Deployed into an account that also runs
        vibld, it would replace vibld’s Workers and write into its database.
      </p>
      <p>Write your own instead, from a settings file:</p>
      <pre>
        <code>{`{
  "prefix": "acme",
  "d1DatabaseId": "<the id wrangler d1 create printed>",
  "clerkFrontendApiUrl": "https://<your instance>.clerk.accounts.dev",
  "provider": "deepseek"
}`}</code>
      </pre>
      <p>
        <code>node scripts/self-host.mjs settings.json</code> writes{' '}
        <code>wrangler.self-host.jsonc</code> beside each Worker’s configuration
        (git ignores it) with every one of those names derived from your prefix:
        Workers <code>acme-web</code>, <code>acme-preview</code> and{' '}
        <code>acme-publish</code>, database and bucket{' '}
        <code>acme-control-plane</code>, Workflow <code>acme-generation</code>,
        the service bindings between them, and the rate-limit namespaces. It
        refuses to write a file that still names anything of vibld’s. Without a{' '}
        <code>builderDomain</code> and a <code>previewDomain</code> the Workers
        are served at <code>workers.dev</code>; the optional settings are listed
        at the top of the script.
      </p>
      <p>
        Pass <code>-c wrangler.self-host.jsonc</code> to every{' '}
        <code>wrangler</code> command, and apply the migrations with{' '}
        <code>
          wrangler d1 migrations apply acme-control-plane --remote -c
          wrangler.self-host.jsonc
        </code>{' '}
        from <code>apps/web</code>: the builder’s own <code>deploy</code> and{' '}
        <code>migrate</code> scripts name vibld’s database.
      </p>
      <p>
        Still yours to set: the alert addresses and the referral origin, if you
        use them, which default to vibld’s. See{' '}
        <a href="/docs/configuration">Settings and secrets</a>.
      </p>

      <h2>The order that works</h2>
      <ol>
        <li>
          <strong>Create the stored state first.</strong> A D1 database and an
          R2 bucket, both named in each Worker’s configuration. The Durable
          Object and the Workflow need no provisioning.
        </li>
        <li>
          <strong>Apply the migrations before deploying the Worker</strong>, not
          after. This one is not a style preference: shipping a Worker whose
          code expects a table that does not exist yet takes the whole thing
          down, and it has happened here. Two migrations once sat unapplied for
          two days and every generation failed with an accounting error until
          somebody applied them by hand. The builder’s <code>deploy</code>{' '}
          script applies them first for you.
        </li>
        <li>
          <strong>Deploy the publish Worker, then the sandbox</strong>, which
          binds it. The sandbox’s container image is built at deploy time, so
          this needs Docker running, and it needs Workers Paid. Set the three
          secrets: <code>PREVIEW_INTERNAL_SECRET</code> on the builder and the
          sandbox, <code>PUBLISH_INTERNAL_SECRET</code> on the builder and the
          publish Worker, and <code>PREVIEW_SHARE_SECRET</code> on the sandbox
          alone. Three different values.
        </li>
        <li>
          <strong>Deploy the builder</strong> last: its service bindings name
          the other two Workers, and Cloudflare refuses the deploy until both
          exist. Build it with <code>VITE_CLERK_PUBLISHABLE_KEY</code> set, and
          give it a provider key and <code>VIBLD_PLATFORM_ADMINS</code> as
          secrets.
        </li>
      </ol>
      <p>
        Migrations are idempotent, so applying them when there is nothing new is
        a no-op. Make it a step in your deploy rather than something you
        remember.
      </p>

      <h2>The domain problem, which will catch you</h2>
      <p>
        A <strong>live</strong> Clerk instance is bound to a domain, and Clerk’s
        Frontend API refuses any request whose origin is not that domain or a
        subdomain of it. A deployment reachable only at a{' '}
        <code>workers.dev</code> URL will therefore not load Clerk at all, which
        looks like a broken sign-in rather than a configuration mismatch.
      </p>
      <p>Two ways through it:</p>
      <ul>
        <li>
          Use a <strong>development</strong> Clerk instance while you are
          standing things up, and switch when you have a domain.
        </li>
        <li>
          Or put the Worker on a custom domain from the start. A custom domain
          route provisions its own DNS record on deploy, but only if the
          deploying token can manage DNS on that zone. A token scoped to Workers
          alone is not enough, and the failure at deploy time does not say so
          very clearly.
        </li>
      </ul>
      <p>
        Adding a custom domain also disables that Worker’s{' '}
        <code>workers.dev</code> address entirely, so the old URL starts
        returning 404 rather than continuing to work alongside the new one.
      </p>
      <p>
        The preview domain needs the same DNS permission, for the sandbox
        Worker’s wildcard route.
      </p>

      <h2>What to check once it is up</h2>
      <ul>
        <li>
          Sign in. If the sign-in page never renders, it is the domain problem
          above, not your Clerk keys.
        </li>
        <li>
          Run one generation. If it is refused because the deployment is closed,
          you are not getting past the gate: your address is not in{' '}
          <code>VIBLD_PLATFORM_ADMINS</code>, or your Clerk session token does
          not carry a verified <code>email</code>, and{' '}
          <code>VIBLD_ACCESS_MODE</code> is not <code>open</code>. If it says
          generation is not configured, the builder is missing a provider key,{' '}
          <code>CLERK_FRONTEND_API_URL</code>, or one of its D1, R2, Durable
          Object or Workflow bindings.
        </li>
        <li>
          Start one sandbox. If it reports itself unavailable rather than
          failing, the service binding or the shared secret is missing on one of
          the two sides, or the sandbox has no <code>PREVIEW_HOSTNAME</code>.
        </li>
      </ul>
      <p>
        Each of those refuses rather than half-working, which is the point: you
        will get an unavailable feature and a reason, not a deployment that
        looks fine until it spends money incorrectly.
      </p>

      <h2>Where the exact commands live</h2>
      <p>
        In the repository, beside the code they deploy:{' '}
        <a
          href={`${SITE.repoUrl}/blob/main/apps/web/README.md`}
          rel="noopener noreferrer"
        >
          apps/web/README.md
        </a>{' '}
        for the builder,{' '}
        <a
          href={`${SITE.repoUrl}/blob/main/apps/preview/README.md`}
          rel="noopener noreferrer"
        >
          apps/preview/README.md
        </a>{' '}
        for the sandbox and{' '}
        <a
          href={`${SITE.repoUrl}/blob/main/apps/publish/README.md`}
          rel="noopener noreferrer"
        >
          apps/publish/README.md
        </a>{' '}
        for publishing. Keeping them there rather than duplicating them here is
        deliberate. A command on a marketing page ages badly and nobody notices.
      </p>
    </DocPage>
  );
}
