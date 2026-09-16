import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, SITE, metaFor } from '../site';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'hosted-vs-self-hosted')!;
const CHECKED = '2026-09-16';

export function meta() {
  return metaFor('/docs/hosted-vs-self-hosted');
}

export default function HostedVsSelfHosted() {
  return (
    <DocPage guide={GUIDE} updated={CHECKED}>
      <p>
        The honest version of this comparison, which is that the difference is
        mostly operations rather than features. There is no reduced build of the
        builder: the source that runs{' '}
        <a href={SITE.appUrl} rel="noopener noreferrer">
          app.vibld.com
        </a>{' '}
        is the source in the repository.
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
          Saving your work, connecting Git, bringing your own model keys, and
          exporting. None of these is behind a paid plan, by policy and not by
          accident.
        </li>
      </ul>

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
          keys, and the two internal shared secrets.
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
      <p>
        If you would rather do that yourself, the source is there and it is
        meant to be run. If you would rather not, that is what a plan buys.
        Either way the project you build is a conventional codebase you can pick
        up and take elsewhere.
      </p>

      <h2>Things only the hosted service has</h2>
      <ul>
        <li>
          <strong>Billing and plans.</strong> Stripe integration exists in the
          source, but a self-hosted copy with no Stripe configuration simply has
          no billing: everyone gets whatever Free-tier allowance you set.
        </li>
        <li>
          <strong>Publishing to a Vibld URL.</strong> Self-hosted, this becomes
          publishing to your own domain, which is a different thing wearing the
          same button.
        </li>
        <li>
          <strong>Referral credit.</strong> It pays out of the hosted service’s
          own ledger, so it is meaningless without one.
        </li>
      </ul>

      <h2>What the terms say</h2>
      <p>
        The licence covering the core, the templates and what you generate is
        set out on the <a href="/legal/licenses">Open-Source Notices</a> page.
        This page is a description of how the two deployments differ in
        practice, not a statement of what you are permitted to do.
      </p>
    </DocPage>
  );
}
