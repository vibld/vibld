import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, metaFor } from '../site';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'configuration')!;
const CHECKED = '2026-09-16';

export function meta() {
  return metaFor('/docs/configuration');
}

export default function Configuration() {
  return (
    <DocPage guide={GUIDE} updated={CHECKED}>
      <p>
        Two kinds of value. A <strong>var</strong> is public: it ships in the
        Worker’s configuration file and is meant to be read. A{' '}
        <strong>secret</strong> is set out of band and never committed. Putting
        one in the other’s place is the mistake this page exists to prevent.
      </p>

      <h2>Secrets</h2>
      <p>
        Every one of these is optional in the same sense: unset means the
        feature it unlocks reports itself unavailable. None of them ever opens
        anything up by being absent.
      </p>
      <ul>
        <li>
          <code>ANTHROPIC_API_KEY</code> or <code>DEEPSEEK_API_KEY</code>, to
          match whichever provider you selected. Without the matching key,
          generation refuses.
        </li>
        <li>
          <code>CLERK_SECRET_KEY</code>, and <code>CLERK_PUBLISHABLE_KEY</code>{' '}
          at build time for the interface. Without them nobody can sign in, and
          every protected endpoint refuses.
        </li>
        <li>
          <code>PREVIEW_INTERNAL_SECRET</code>, shared with the sandbox Worker.
          Both sides must carry the same value.
        </li>
        <li>
          <code>PUBLISH_INTERNAL_SECRET</code>, shared with the publish Worker.
          Deliberately a different value from the one above: a leak of one must
          not compromise the other.
        </li>
        <li>
          <code>STRIPE_SECRET_KEY</code> and <code>STRIPE_WEBHOOK_SECRET</code>,
          only if you are charging.
        </li>
        <li>
          <code>VIBLD_MODEL_POLICY</code>, JSON naming which models each
          identity may use. A secret rather than a var because it names people.
          Absent means no policy: everyone may use whatever the deployment can
          serve.
        </li>
      </ul>
      <p>
        The GitHub App’s four values (<code>VIBLD_GITHUB_APP_ID</code>,{' '}
        <code>VIBLD_GITHUB_PRIVATE_KEY</code>,{' '}
        <code>VIBLD_GITHUB_CLIENT_ID</code>,{' '}
        <code>VIBLD_GITHUB_CLIENT_SECRET</code>) are secrets too. The private
        key is a PEM file that downloads once; it belongs in a secret store and
        nowhere else, not in an email and not pasted into a chat window.
      </p>

      <h2>Vars you have to set</h2>
      <ul>
        <li>
          <code>VIBLD_PROVIDER</code>: <code>anthropic</code> or{' '}
          <code>deepseek</code>. Explicit beats inferred, so set it rather than
          relying on which key happens to be present.
        </li>
        <li>
          <code>CLERK_FRONTEND_API_URL</code>: your Clerk instance’s Frontend
          API URL. A public identifier, not a secret. It is both the issuer the
          Worker matches tokens against and the base it fetches the signing keys
          from.
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
          <code>VIBLD_SIGNUP_CREDIT_FROM</code>: the one-time grant for a new
          account, and the instant from which accounts count as new. The second
          has no default on purpose. Any default early enough to catch new
          accounts also catches every account that already exists, and this is
          money.
        </li>
      </ul>

      <h2>Vars you should probably leave alone</h2>
      <p>
        <code>VIBLD_USD_MICRO_PER_INPUT_TOKEN</code> and{' '}
        <code>VIBLD_USD_MICRO_PER_OUTPUT_TOKEN</code> override the running
        model’s own rate. There is one good reason to set them, which is that
        the built-in rate for your model is wrong.
      </p>
      <p>
        Setting them for any other reason has a specific failure that has
        already happened once here: pinning one provider’s prices while running
        another’s model ceilinged every run at roughly forty times its real
        cost, which turned a budget that afforded forty generations a day into
        two.
      </p>
    </DocPage>
  );
}
