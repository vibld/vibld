import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, SITE, metaFor } from '../site';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'self-hosting')!;
const CHECKED = '2026-09-16';

export function meta() {
  return metaFor('/docs/self-hosting');
}

export default function SelfHosting() {
  return (
    <DocPage guide={GUIDE} updated={CHECKED}>
      <p>
        Vibld’s source is public at{' '}
        <a href={SITE.repoUrl} rel="noopener noreferrer">
          github.com/vibld/vibld
        </a>
        . This page is what you are taking on before you start: the moving
        parts, the state behind them, and the accounts you will need.
      </p>
      <p>
        The terms that govern using and modifying that source are on the{' '}
        <a href="/legal/licenses">Open-Source Notices</a> page. Read them there
        rather than trusting a paraphrase on this one.
      </p>

      <h2>Three Workers, not one</h2>
      <p>
        Vibld is not a single deployable. It is three Cloudflare Workers with
        deliberately different blast radii:
      </p>
      <ul>
        <li>
          <strong>The builder</strong> serves the interface and the API. It
          talks to the model, holds the spend ledger and owns the database.
        </li>
        <li>
          <strong>The sandbox Worker</strong> installs dependencies and runs
          generated code. It is separate because it executes code a model wrote,
          and that does not belong in the same Worker as your provider keys.
        </li>
        <li>
          <strong>The publish Worker</strong> serves published builds. Separate
          again, and with its own shared secret rather than the sandbox’s, so
          that leaking one does not compromise the other.
        </li>
      </ul>

      <h2>What holds the state</h2>
      <ul>
        <li>
          <strong>D1</strong> for control-plane metadata: generations, billing
          mirrors, GitHub bindings, referrals. The schema is a set of numbered
          migrations in the repository.
        </li>
        <li>
          <strong>R2</strong> for the file content those rows point at.
        </li>
        <li>
          <strong>A Durable Object</strong> for the per-user spend ledger. It is
          what makes a ceiling a ceiling rather than a suggestion, so a
          deployment without it cannot enforce spend at all.
        </li>
        <li>
          <strong>A Workflow</strong> for generation, so a run survives the
          request that started it.
        </li>
      </ul>
      <p>
        D1 and R2 have to be created and named. The Durable Object and the
        Workflow do not: they come into existence on first use.
      </p>

      <h2>Accounts you need</h2>
      <ul>
        <li>
          <strong>Cloudflare</strong>. The Workers free plan is enough to stand
          it up. The Durable Object is configured for SQLite storage
          specifically because that is the only backend available there.
        </li>
        <li>
          <strong>A model provider</strong>: Anthropic or DeepSeek. One key.
          Without it, generation refuses rather than degrading.
        </li>
        <li>
          <strong>Clerk</strong>, for sign-in. Without it every protected
          endpoint refuses. There is no “no auth” mode, on purpose: the
          endpoints spend money.
        </li>
      </ul>

      <h2>Accounts you probably do not need</h2>
      <ul>
        <li>
          <strong>Stripe</strong>, unless you intend to charge somebody. Without
          it, billing endpoints report themselves unconfigured and everyone is
          on the Free tier’s allowance, which you can set to whatever you like.
        </li>
        <li>
          <strong>A GitHub App</strong>, unless you want the push-to-repository
          feature. Without it, those endpoints answer “not configured”.
        </li>
      </ul>
      <p>
        Every optional piece fails the same way: unset means the feature reports
        itself unavailable, never that it quietly runs without a check.
      </p>

      <h2>Next</h2>
      <ul>
        <li>
          <a href="/docs/configuration">Settings and secrets</a>, which is every
          value the Worker reads and what happens without each one.
        </li>
        <li>
          <a href="/docs/deploying">Deploying your own copy</a>.
        </li>
        <li>
          <a href="/docs/hosted-vs-self-hosted">
            What differs from the hosted service
          </a>
          , which is mostly operations rather than code.
        </li>
      </ul>
    </DocPage>
  );
}
