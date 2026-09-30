import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, SITE, metaFor } from '../site';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'self-hosting')!;
const CHECKED = '2026-09-30';

export function meta() {
  return metaFor('/docs/self-hosting');
}

export default function SelfHosting() {
  return (
    <DocPage guide={GUIDE} updated={CHECKED}>
      <p>
        vibld’s source is public at{' '}
        <a href={SITE.repoUrl} rel="noopener noreferrer">
          github.com/vibld/vibld
        </a>
        . This page is what you are taking on before you start: the moving
        parts, the state behind them, and the accounts you will need.
      </p>
      <p>
        <strong>Checked by the project, not yet by anyone else.</strong> A
        workflow deploys a separately named copy from these docs and confirms it
        comes up and refuses a signed-out caller. Sign-in and generation on a
        copy are not checked, and nobody outside the project has deployed their
        own yet. Expect to be among the first, and to find gaps.
      </p>
      <p>
        If what you want is a real build with your own model key, you do not
        need any of this. <code>pnpm generate</code> in a clone runs the same
        bounded build with one provider key and no Cloudflare, Clerk or
        database; the{' '}
        <a href={`${SITE.repoUrl}#quick-start`} rel="noopener noreferrer">
          repository’s Quick start
        </a>{' '}
        has the command. <code>pnpm --filter @vibld/web dev</code> runs the
        builder’s interface locally, but against a deterministic fake provider:
        no model is called.
      </p>
      <p>
        The terms that govern using and modifying that source are on the{' '}
        <a href="/legal/licenses">Open-Source Notices</a> page. Read them there
        rather than trusting a paraphrase on this one.
      </p>

      <h2>Three Workers, not one</h2>
      <p>
        vibld is not a single deployable. It is three Cloudflare Workers with
        deliberately different blast radii:
      </p>
      <ul>
        <li>
          <strong>The builder</strong> serves the interface and the API. It
          talks to the model, holds the spend ledger and owns the database.
        </li>
        <li>
          <strong>The sandbox Worker</strong> installs dependencies and runs
          generated code in a container, for live previews and for the build
          behind a publish. It is separate because it executes code a model
          wrote, and that does not belong in the same Worker as your provider
          keys. It also signs share links, with a secret of its own.
        </li>
        <li>
          <strong>The publish Worker</strong> stores and serves published
          builds. Separate again, and with its own shared secret rather than the
          sandbox’s, so that leaking one does not compromise the other.
        </li>
      </ul>

      <h2>What holds the state</h2>
      <ul>
        <li>
          <strong>D1</strong> for control-plane metadata: projects, generations,
          billing mirrors, GitHub bindings, invites, referrals. The schema is a
          set of numbered migrations in the repository.
        </li>
        <li>
          <strong>R2</strong> for the file content those rows point at.
        </li>
        <li>
          <strong>A Durable Object</strong> for the per-user spend ledger. It is
          what makes a ceiling a ceiling rather than a suggestion, so a
          deployment without it cannot generate at all.
        </li>
        <li>
          <strong>A Workflow</strong> for generation, so a run survives the
          request that started it.
        </li>
      </ul>
      <p>
        D1 and R2 have to be created and named, and all three Workers bind the
        same database and bucket. The Durable Object and the Workflow do not:
        they come into existence on first use.
      </p>

      <h2>Accounts you need</h2>
      <ul>
        <li>
          <strong>Cloudflare, on Workers Paid</strong> for previews and
          publishing. Both run generated code in Containers, which the Workers
          free plan does not include, and the container image is built at deploy
          time, so the machine you deploy from needs Docker. Whether the builder
          alone runs on the free plan has not been tried: that plan allows 10 ms
          of CPU per request and per Workflow step, and the builder’s
          configuration asks for five minutes, which is a Paid setting.
        </li>
        <li>
          <strong>Two domains on that account.</strong> One for the builder, and
          a second registrable domain for previews, share links and published
          sites, each on its own subdomain under a wildcard route. Generated
          code never shares cookie scope with the builder that way.
        </li>
        <li>
          <strong>A model provider</strong>: Anthropic, DeepSeek or OpenAI. One
          key is enough. Without any, generation refuses rather than degrading.
        </li>
        <li>
          <strong>Clerk</strong>, for sign-in. Without it every protected
          endpoint refuses. There is no “no auth” mode, on purpose: the
          endpoints spend money. The session token has to carry the user’s{' '}
          <code>email</code> and a boolean <code>email_verified</code> claim,
          which Clerk does not add by default. Without them nobody’s email
          counts as verified, so no admin and no invite matches anybody.
        </li>
      </ul>

      <h2>The door starts closed</h2>
      <p>
        A new deployment is closed. Unless <code>VIBLD_ACCESS_MODE</code> is
        exactly <code>open</code>, the only accounts that can generate are the
        verified emails in <code>VIBLD_PLATFORM_ADMINS</code> and the addresses
        those admins invite. Everyone else, you included if you left yourself
        off the list, is refused and told to ask for access. Put your own
        address in <code>VIBLD_PLATFORM_ADMINS</code> before you try anything.
      </p>
      <p>
        Admins get an admin panel in the builder: invites, credit grants, bans,
        account deletions, publish takedowns and an audit log. Invites need only
        the admin list and the database. Looking an account up by email,
        banning, and deleting the sign-in account also need{' '}
        <code>CLERK_SECRET_KEY</code>.
      </p>

      <h2>Accounts you probably do not need</h2>
      <ul>
        <li>
          <strong>Stripe</strong>, unless you intend to charge somebody. Without
          it, billing endpoints report themselves unconfigured and everyone is
          on the Free tier’s allowance, which you can set to whatever you like.
          The one-time welcome credit waits for a card saved through Stripe, so
          without it nobody receives that either.
        </li>
        <li>
          <strong>A GitHub App</strong>, unless you want the push-to-repository
          feature. Without it, those endpoints answer “not configured”.
        </li>
        <li>
          <strong>Resend</strong>, only for the nightly email that warns when
          the DeepSeek balance runs low. The builder uses it for nothing else.
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
          value the Workers read and what happens without each one.
        </li>
        <li>
          <a href="/docs/deploying">Deploying your own copy</a>, including the
          values in the repository that name vibld’s own deployment and have to
          change for yours.
        </li>
        <li>
          <a href="/docs/hosted-vs-self-hosted">
            What differs from the hosted service
          </a>
          , which is mostly operations rather than code.
        </li>
        <li>
          The exact commands, beside the code they deploy:{' '}
          <a
            href={`${SITE.repoUrl}/blob/main/apps/web/README.md`}
            rel="noopener noreferrer"
          >
            apps/web/README.md
          </a>
          ,{' '}
          <a
            href={`${SITE.repoUrl}/blob/main/apps/preview/README.md`}
            rel="noopener noreferrer"
          >
            apps/preview/README.md
          </a>{' '}
          and{' '}
          <a
            href={`${SITE.repoUrl}/blob/main/apps/publish/README.md`}
            rel="noopener noreferrer"
          >
            apps/publish/README.md
          </a>
          .
        </li>
      </ul>
    </DocPage>
  );
}
