import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, SITE, metaFor } from '../site';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'deploying')!;
const CHECKED = '2026-09-16';

export function meta() {
  return metaFor('/docs/deploying');
}

export default function Deploying() {
  return (
    <DocPage guide={GUIDE} updated={CHECKED}>
      <p>
        From a clone to a running builder. The repository’s own{' '}
        <code>apps/web/README.md</code> carries the exact commands and stays
        with the code, so it is the version to follow; this page is the shape of
        the job and the parts that bite.
      </p>

      <h2>The order that works</h2>
      <ol>
        <li>
          <strong>Create the stored state first.</strong> A D1 database and an
          R2 bucket, both named in the Worker’s configuration. The Durable
          Object and the Workflow need no provisioning.
        </li>
        <li>
          <strong>Apply the migrations before deploying the Worker</strong>, not
          after. This one is not a style preference: shipping a Worker whose
          code expects a table that does not exist yet takes the whole thing
          down, and it has happened here. Two migrations once sat unapplied for
          two days and every generation failed with an accounting error until
          somebody applied them by hand.
        </li>
        <li>
          <strong>Deploy the sandbox and publish Workers</strong>, and set the
          two shared secrets on both sides of each pair.
        </li>
        <li>
          <strong>Deploy the builder</strong> with its service bindings pointing
          at those two.
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

      <h2>What to check once it is up</h2>
      <ul>
        <li>
          Sign in. If the sign-in page never renders, it is the domain problem
          above, not your Clerk keys.
        </li>
        <li>
          Run one generation. If it refuses, the provider key and{' '}
          <code>VIBLD_PROVIDER</code> disagree, or the spend ledger has no
          Durable Object binding.
        </li>
        <li>
          Start one sandbox. If it reports itself unavailable rather than
          failing, the service binding or the shared secret is missing on one of
          the two sides.
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
        </a>
        . Keeping them there rather than duplicating them here is deliberate. A
        command on a marketing page ages badly and nobody notices.
      </p>
    </DocPage>
  );
}
