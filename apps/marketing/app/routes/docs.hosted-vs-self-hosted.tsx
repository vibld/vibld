import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, SITE, metaFor } from '../site';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'hosted-vs-self-hosted')!;
const CHECKED = '2026-10-02';

export function meta() {
  return metaFor('/docs/hosted-vs-self-hosted');
}

export default function HostedVsSelfHosted() {
  return (
    <DocPage guide={GUIDE} updated={CHECKED}>
      <p>
        The difference is mostly operations rather than features. There is no
        reduced build of the builder: the source that runs{' '}
        <a href={SITE.appUrl} rel="noopener noreferrer">
          app.vibld.com
        </a>{' '}
        is the source in the repository.
      </p>
      <p>
        The project checks that a copy deploys from the docs, that its owner can
        sign in, and that it builds one site with a real model, on Cloudflare
        and under Docker. Nobody outside the project has deployed their own copy
        yet.
      </p>

      <h2>The same either way</h2>
      <ul>
        <li>
          Generation, iteration, standing instructions and style direction.
        </li>
        <li>
          Running a project in a sandbox, sharing it, and revoking the share.
        </li>
        <li>
          Exporting the project, and pushing it to a repository as a branch and
          a pull request.
        </li>
        <li>
          Saving your work, connecting Git, and exporting. None of these is
          behind a paid plan, by policy.
        </li>
      </ul>

      <h2>Things only your own copy has</h2>
      <ul>
        <li>
          <strong>Your own model keys.</strong> The hosted service holds no
          user’s provider key; it sells model spend instead. Bringing your own
          key is for a self-hosted copy or the command line.
        </li>
      </ul>

      <h2>Running it on your own machine</h2>
      <p>
        <code>pnpm --filter @vibld/web dev</code> runs the builder’s interface
        locally with no sign-in and a deterministic fake provider, so you can go
        through the whole flow at no cost, but no model is called. Its real
        model path needs sign-in, D1, R2 and a Workflow, which a Cloudflare
        deployment has and so does Docker.
      </p>
      <p>
        <code>docker compose up</code> runs the whole builder on one machine
        with no Cloudflare account: sign in with an owner password, build with
        your own key or a local model, and preview each project in a container
        on your Docker. The{' '}
        <a
          href={`${SITE.repoUrl}#run-it-with-docker`}
          rel="noopener noreferrer"
        >
          repository’s Docker section
        </a>{' '}
        has the steps.
      </p>
      <p>
        Without the builder, the command line builds too:{' '}
        <code>{'pnpm generate "your prompt" --out ./site --build'}</code> with
        one provider key set. It runs the same bounded build as the hosted
        builder, writes the project, and with <code>--build</code> installs and
        builds it with npm, asking the model for one repair if that fails. A
        weekly workflow proves it from a clean clone. The{' '}
        <a href={`${SITE.repoUrl}#quick-start`} rel="noopener noreferrer">
          repository’s Quick start
        </a>{' '}
        has the details.
      </p>

      <h2>What you take on by running your own</h2>
      <ul>
        <li>
          <strong>The provider bill.</strong> You pay the model provider
          directly, at their rates, with no plan in between. For one person this
          is usually cheaper. It is also uncapped unless you set the ceilings
          yourself.
        </li>
        <li>
          <strong>Setting those ceilings.</strong> The deployment-wide daily
          ceiling ships with a default that is a starting point, not a measured
          figure. Nobody else is going to notice a runaway loop on your account.
        </li>
        <li>
          <strong>Migrations.</strong> Every schema change has to be applied
          before the Worker that expects it is deployed. Getting this backwards
          takes the deployment down.
        </li>
        <li>
          <strong>Secret rotation</strong>, for the provider key, the Clerk
          keys, the two internal shared secrets and the share-link secret.
        </li>
        <li>
          <strong>Who gets in.</strong> A copy starts closed to everyone but the
          admins you list, until you invite people or open it.
        </li>
        <li>
          <strong>Sandbox capacity.</strong> Queueing, expiry and cleanup are
          yours to watch.
        </li>
      </ul>

      <h2>What the hosted service is actually selling</h2>
      <p>
        Not the code. It is the operating: a provider key that is topped up, a
        sandbox fleet somebody is watching, migrations applied in the right
        order, a spend ceiling tuned against real usage rather than a guess, and
        somebody to ask when it breaks.
      </p>

      <h2>Things only the hosted service has</h2>
      <ul>
        <li>
          <strong>Billing and plans.</strong> Stripe integration exists in the
          source, but a self-hosted copy with no Stripe configuration simply has
          no billing: everyone gets whatever Free-tier allowance you set, and no
          one gets the welcome credit, which waits for a card saved through
          Stripe.
        </li>
        <li>
          <strong>Publishing to a vibld URL.</strong> Self-hosted, the same
          button publishes to your own domain.
        </li>
        <li>
          <strong>Referral credit.</strong> It pays out of the hosted service’s
          own ledger, so it is meaningless without one.
        </li>
      </ul>

      <h2>What the terms say</h2>
      <p>
        The license covering the core, the templates and what you generate is
        set out on the <a href="/legal/licenses">Open-Source Notices</a> page.
        This page describes how the two deployments differ, not what you are
        permitted to do.
      </p>
    </DocPage>
  );
}
