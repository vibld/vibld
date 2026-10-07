import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, SITE, metaFor } from '../site';
import { FREE_PLAN } from '../plan-sources';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'configuration')!;
const CHECKED = '2026-09-30';

export function meta() {
  return metaFor('/docs/configuration');
}

export default function Configuration() {
  return (
    <DocPage guide={GUIDE} updated={CHECKED}>
      <p>
        Two kinds of value. A <strong>var</strong> is public: it ships in the
        Worker’s <code>wrangler.jsonc</code> and is meant to be read. A{' '}
        <strong>secret</strong> is set out of band, with{' '}
        <code>wrangler secret put</code>, and never committed. Everything here
        is the builder’s unless it says otherwise;{' '}
        <a
          href={`${SITE.repoUrl}/blob/main/apps/web/.env.example`}
          rel="noopener noreferrer"
        >
          apps/web/.env.example
        </a>{' '}
        lists the builder’s secrets with the shape of each.
      </p>
      <p>
        For a copy of your own, <code>scripts/self-host.mjs</code> writes the
        names, <code>CLERK_FRONTEND_API_URL</code>, <code>VIBLD_PROVIDER</code>{' '}
        and <code>VIBLD_MODEL</code> from a settings file, and drops{' '}
        <code>VIBLD_MODEL</code> unless you give one, so the provider’s default
        answers. See <a href="/docs/deploying">Deploying</a>.
      </p>

      <h2>Secrets</h2>
      <p>
        Each is optional: unset means the feature it unlocks reports itself
        unavailable, never that anything opens up.
      </p>
      <ul>
        <li>
          <code>ANTHROPIC_API_KEY</code>, <code>DEEPSEEK_API_KEY</code> or{' '}
          <code>OPENAI_API_KEY</code>. Any one makes generation available, and
          so does a local model (below); without any, generation refuses.
          Setting more than one makes each of those providers’ models available
          to choose from, within whatever <code>VIBLD_MODEL_POLICY</code> below
          allows.
        </li>
        <li>
          <code>VIBLD_LOCAL_API_KEY</code>: only for a local model server
          started with an API key.
        </li>
        <li>
          <code>VIBLD_PLATFORM_ADMINS</code>, comma-separated email addresses.
          Each is matched against the verified email in the caller’s Clerk
          session. An admin is always past the invite gate and gets the admin
          panel. Unset means no admins, and on a deployment that is not open,
          nobody at all can generate.
        </li>
        <li>
          <code>CLERK_SECRET_KEY</code>. Not needed for sign-in, which verifies
          sessions against public keys. It powers the admin tools that talk to
          Clerk: approving an invited address in Clerk, looking an account up by
          email for credit grants, banning, and deleting the sign-in account
          when an account is purged. Each of those says so when the key is
          missing.
        </li>
        <li>
          <code>PREVIEW_INTERNAL_SECRET</code>, shared with the sandbox Worker.
          Both sides must carry the same value.
        </li>
        <li>
          <code>PUBLISH_INTERNAL_SECRET</code>, shared with the publish Worker.
          Deliberately a different value from the one above: a leak of one must
          not compromise the other. Publishing needs both, because the sandbox
          builds what the publish Worker serves.
        </li>
        <li>
          <code>STRIPE_SECRET_KEY</code> and <code>STRIPE_WEBHOOK_SECRET</code>,
          only if you are charging.
        </li>
        <li>
          <code>VIBLD_MODEL_POLICY</code>, JSON naming which models each
          identity may use. A secret rather than a var because it names people.
          Absent means no policy: everyone may use whatever the deployment can
          serve. Where billing is configured, a Free account is held to{' '}
          {FREE_PLAN.models} whatever the policy grants, so a deployment that
          charges needs a key that serves it for its Free accounts to build at
          all.
        </li>
      </ul>
      <p>
        The GitHub App’s five values (<code>VIBLD_GITHUB_APP_ID</code>,{' '}
        <code>VIBLD_GITHUB_PRIVATE_KEY</code>,{' '}
        <code>VIBLD_GITHUB_CLIENT_ID</code>,{' '}
        <code>VIBLD_GITHUB_CLIENT_SECRET</code>,{' '}
        <code>VIBLD_GITHUB_WEBHOOK_SECRET</code>) are secrets too. Without the
        webhook secret, pushing still works but <code>/api/github/webhook</code>{' '}
        answers 503, so a merged pull request goes on being shown as open. The
        private key is a PEM file that downloads once; it belongs in a secret
        store and nowhere else.
      </p>

      <h2>Sign-in</h2>
      <ul>
        <li>
          <code>CLERK_FRONTEND_API_URL</code>, a var: your Clerk instance’s
          Frontend API URL. A public identifier, not a secret. It is both the
          issuer the Worker matches tokens against and the base it fetches the
          signing keys from. The shipped value is vibld’s own.
        </li>
        <li>
          <code>VITE_CLERK_PUBLISHABLE_KEY</code>, a build variable rather than
          a Worker secret: Vite inlines it into the interface when you build.
          Locally it goes in <code>apps/web/.env.local</code>, not in{' '}
          <code>.dev.vars</code>. (vibld’s own deploy stores it as a secret
          called <code>CLERK_PUBLISHABLE_KEY</code> and passes it to the build
          under this name.) Without it the interface has no sign-in, and every
          request it makes is refused.
        </li>
      </ul>

      <h2>The invite gate</h2>
      <p>
        <code>VIBLD_ACCESS_MODE</code> decides who may use the deployment once
        signed in. Only the exact string <code>open</code> lets every signed-in
        account in. Anything else, including unset, <code>OPEN</code> and{' '}
        <code>open</code> with a trailing space, keeps the gate shut to all but
        platform admins and the addresses they invite. It is not in the shipped{' '}
        <code>wrangler.jsonc</code>, so a fresh deployment is closed. vibld’s
        own deploy sets it as a secret; a var works the same.
      </p>

      <h2>Vars you have to set</h2>
      <ul>
        <li>
          <code>VIBLD_PROVIDER</code>: <code>anthropic</code>,{' '}
          <code>deepseek</code>, <code>openai</code> or <code>local</code>, the
          provider that answers when no model is named. Set it rather than
          relying on which key is present. Any other value is an error.
        </li>
        <li>
          <code>VIBLD_LOCAL_BASE_URL</code> and <code>VIBLD_LOCAL_MODEL</code>:
          a model on a server of your own, such as Ollama, LM Studio or
          llama.cpp. The first is the server’s OpenAI-compatible address, ending
          in <code>/v1</code>, and the second the model’s name there. Both are
          needed. The builder offers it as “Local: ” and its name, and it costs
          nothing against anybody’s allowance. A Worker on Cloudflare reaches
          only the public internet, so the server has to be reachable from
          there; under Docker it can be on your own machine. Give the model a
          context window of 32,768 tokens or more.
        </li>
        <li>
          <code>VIBLD_MODEL</code>: the default model, which beats{' '}
          <code>VIBLD_PROVIDER</code> when set. The shipped{' '}
          <code>wrangler.jsonc</code> sets <code>VIBLD_PROVIDER</code> to{' '}
          <code>openai</code> and this to <code>gpt-6-sol</code>. If your keys
          cannot serve the model named here, the builder does not refuse: it
          falls back to the first model it can serve in catalog order, which on
          an Anthropic-only deployment is Claude Fable 5.1, the dearest
          Anthropic model. Set it to a model your key serves, or delete it to
          get the provider’s default. On the command line, a set{' '}
          <code>VIBLD_MODEL</code> picks the provider outright.
        </li>
      </ul>

      <h2>Vars that bound spend</h2>
      <ul>
        <li>
          <code>VIBLD_ACCOUNT_DAILY_MICRO_USD</code>: what the whole deployment
          may spend per UTC day, across every account. This is the one that
          stops a compromised account spending the month. The shipped default is
          a starting point, not a measured figure.
        </li>
        <li>
          <code>VIBLD_FREE_MONTHLY_MICRO_USD</code>: the Free tier’s monthly
          allowance. Set it only to change that figure. Paid tiers are not
          configurable here, since their included spend is fixed by the price
          table rather than by an operator.
        </li>
        <li>
          <code>VIBLD_MAX_IN_FLIGHT</code>: concurrent runs per user.
        </li>
        <li>
          <code>VIBLD_SIGNUP_CREDIT_USD_CENTS</code> and{' '}
          <code>VIBLD_SIGNUP_CREDIT_FROM</code>: an optional one-time grant for
          a new account (0 cents, off, unless set), and the instant from which
          accounts count as new. The second has no default: any default early
          enough to catch new accounts would also catch every existing one. The
          grant waits for a card saved through Stripe, so it needs billing
          configured and the Stripe webhook subscribed to{' '}
          <code>checkout.session.completed</code> or{' '}
          <code>setup_intent.succeeded</code>; without Stripe nobody gets it.
        </li>
      </ul>

      <h2>Your own domains</h2>
      <ul>
        <li>
          <code>PREVIEW_HOSTNAME</code>, on the sandbox Worker: the domain
          previews and share links are minted under. It has to match that
          Worker’s wildcard route. Unset, previews report themselves not
          configured.
        </li>
        <li>
          <code>PUBLISH_HOSTNAME</code>, on the publish Worker and on the
          builder: the domain published sites are served under, and the address
          a project shows for its site. Both default to{' '}
          <code>vibld-preview.dev</code>, so set both. Published sites share the
          preview domain: the sandbox Worker hands the publish Worker every host
          that is not a preview or a share.
        </li>
        <li>
          <code>VIBLD_REFERRAL_ORIGIN</code>: where a referral link points.
          Unset, it is your builder’s own address.
        </li>
      </ul>

      <h2>The other two Workers’ secrets</h2>
      <ul>
        <li>
          The sandbox Worker carries <code>PREVIEW_INTERNAL_SECRET</code> (the
          builder’s value) and <code>PREVIEW_SHARE_SECRET</code>, which signs
          share links. A third, separate value that only the sandbox holds:
          without it, sharing reports itself not configured.
        </li>
        <li>
          The publish Worker carries <code>PUBLISH_INTERNAL_SECRET</code> (the
          builder’s value).
        </li>
      </ul>

      <h2>Email</h2>
      <p>
        <code>RESEND_API_KEY</code> turns on one email: a nightly warning when
        the DeepSeek balance is below{' '}
        <code>VIBLD_DEEPSEEK_BALANCE_ALERT_USD</code> (default 10). It goes to{' '}
        <code>VIBLD_ALERT_EMAIL</code> from <code>VIBLD_ALERT_FROM</code>, whose
        defaults are vibld’s own addresses, so set both. The From address has to
        be on a domain your Resend account can send from.
      </p>

      <h2>Vars you should probably leave alone</h2>
      <p>
        <code>VIBLD_USD_MICRO_PER_INPUT_TOKEN</code> and{' '}
        <code>VIBLD_USD_MICRO_PER_OUTPUT_TOKEN</code> override the running
        model’s own rate. Set them only if the built-in rate for your model is
        wrong. Pinning one provider’s prices while running another’s model has
        already ceilinged every run here at roughly forty times its real cost,
        turning a budget of forty generations a day into two.
      </p>
      <ul>
        <li>
          <code>VIBLD_REPLAY_QUERY_BUDGET</code>: the D1 queries the nightly
          billing pass may spend in one invocation. Unset means 40, which fits
          the Workers free plan’s limit of 50. The shipped{' '}
          <code>wrangler.jsonc</code> sets 500, sized for Workers Paid. Above
          your plan’s limit, the pass fails at the same point every night.
        </li>
        <li>
          <code>VIBLD_STREAM_KEEPALIVE_MS</code>: milliseconds between
          keepalives on the generation stream. Default 10000; a value outside
          1000 to 60000 is ignored.
        </li>
      </ul>
    </DocPage>
  );
}
