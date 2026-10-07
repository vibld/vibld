import { LegalPage } from '../components/SiteChrome';
import { LEGAL_DOCS, SITE, metaFor } from '../site';

const DOC = LEGAL_DOCS.find((d) => d.slug === 'privacy')!;
const UPDATED = SITE.legalEffectiveDate;

export function meta() {
  return metaFor('/legal/privacy');
}

export default function Privacy() {
  return (
    <LegalPage title={DOC.label} updated={UPDATED}>
      <p>
        This policy describes what {SITE.legalEntity} (&ldquo;{SITE.name}
        &rdquo;, &ldquo;we&rdquo;) collects through this website ({SITE.url}),
        the builder at {SITE.appUrl}, and the previews, share links and
        published sites on <code>vibld-preview.dev</code>; what we do with it;
        who else receives it; and how long it is kept.
      </p>

      <h2>Your account</h2>
      <p>
        Accounts are run by Clerk. You can sign in with Google, with GitHub, or
        with your email address and a password, and you can also sign in with a
        one-time code sent to your email address or with a passkey. Clerk holds
        your email address, whether it is verified, your name if you give one,
        when the account was created, and the details of how you sign in. Clerk
        checks sign-ups with Cloudflare Turnstile and refuses disposable email
        domains. Our own records identify you by the user id Clerk assigns; your
        email address is used for display, for admin support, and to check you
        are who an admin list or invitation names.
      </p>

      <h2>Your projects</h2>
      <p>When you use the builder, we store and process:</p>
      <ul>
        <li>
          <strong>What you send with a run</strong>: your prompt, the style you
          pick, any direction you chose from a quick mockup, and, if you give
          one, the address of a reference page. vibld fetches that page from its
          own servers, and only its visible text and some values measured from
          its styles, such as its main color, go into the run.
        </li>
        <li>
          <strong>Standing instructions and style preferences</strong>, which
          are kept in your browser (see the{' '}
          <a href="/legal/cookies">Cookie Notice</a>) and sent with each run.
        </li>
        <li>
          <strong>Your project&apos;s files.</strong> Every version a run
          produces, accepted or not, is stored in Cloudflare R2, with a record
          in Cloudflare D1 of which version is accepted.
        </li>
        <li>
          <strong>Images and video you upload</strong>, stored in Cloudflare R2
          with their file name, type, size and the alt text you give them.
        </li>
        <li>
          <strong>A record of each run</strong>: the model, how it ended, tokens
          used, cost and duration. This record contains no prompt and no code.
        </li>
        <li>
          <strong>Spend and credit</strong>: how much of your allowance and
          credit each run reserved and used, kept in a Cloudflare Durable Object
          for your account.
        </li>
      </ul>
      <p>
        While a run is in progress, its prompt, standing instructions, reference
        text and your email address are held in Cloudflare Workflows, which runs
        the generation. Cloudflare Workflows keeps a finished run for 30 days,
        and deleting your account does not shorten that.
      </p>

      <h2>What model providers receive</h2>
      <p>
        Each run is sent to the provider of the model you choose in the builder,
        or of the default model if you do not choose. The default model is
        OpenAI&apos;s GPT-6 Sol. Where the builder offers them, you can choose
        other models: Anthropic for Claude models, OpenAI for GPT models,
        DeepSeek for DeepSeek models. The provider for a run receives your
        prompt, your standing instructions, your style choices, any
        reference-page text, the mockup you chose, the names, types and alt text
        of your uploaded media (not the files themselves), and every file
        currently in your project. A quick mockup, run before a project exists,
        sends only the prompt and the style. Providers do not receive your name,
        email address or account id.
      </p>
      <p>
        Each provider&apos;s own terms decide how long it keeps what it receives
        and whether it may use it. As each provider publishes them:
      </p>
      <ul>
        <li>
          <strong>Anthropic</strong> does not use API inputs or outputs to train
          its models by default, and deletes them within 30 days, except where
          it must keep them longer by law or to enforce its usage policy (up to
          two years for content its automated safety systems flag).
        </li>
        <li>
          <strong>OpenAI</strong> does not use data sent to its API to train its
          models unless the customer opts in, and keeps API inputs and outputs
          in abuse-monitoring logs for up to 30 days, unless the law or
          protecting its services requires longer. vibld sends requests to
          OpenAI with its option to store responses turned off, so no response
          is kept for later retrieval.
        </li>
        <li>
          <strong>DeepSeek</strong>, when you choose a DeepSeek model, stores
          data in the People&apos;s Republic of China, and its terms allow it to
          use inputs and outputs, after de-identifying them, to improve its
          services. DeepSeek does not publish how long it keeps API inputs and
          outputs.
        </li>
      </ul>

      <h2>Payments</h2>
      <p>
        Payments go through Stripe&apos;s hosted checkout and billing portal.
        Stripe collects your card and billing details; they never reach us. We
        keep: the Stripe customer id linked to your account, your
        subscription&apos;s plan, status and period, the amount and Stripe ids
        of each payment, top-ups and credit grants, and, when you save a card
        for the Free plan&apos;s monthly allowance, Stripe&apos;s fingerprint of
        that card, which is how the allowance is limited to one account per
        card. We never see or store the card number.
      </p>

      <h2>Referrals</h2>
      <p>
        If you use a referral link, we record which account referred yours, the
        code, when, and whether and from which payment a reward was paid or
        taken back. An account that refers others can see only how many people
        it referred and how many of them earned a reward, not who they are.
      </p>

      <h2>GitHub, previews and publishing</h2>
      <ul>
        <li>
          <strong>GitHub.</strong> When you connect a repository we store the
          GitHub App installation, the repository, the branch, the email address
          of the vibld account that connected it, when, and when the connection
          expires (90 days), plus a record of each push and pull request. The
          token GitHub gives us while you connect is used to list your
          repositories and then discarded; each push uses a short-lived token
          for that one repository, which is not stored.
        </li>
        <li>
          <strong>Previews.</strong> Running a preview copies your project into
          a Cloudflare container, which installs its packages from the public
          npm registry and can reach nothing else on the internet. The container
          is thrown away when the preview stops. Share links you create are
          recorded with when they expire and whether you revoked them.
        </li>
        <li>
          <strong>Published sites</strong> are public by design, including the
          uploaded media they reference. We keep the three most recent published
          versions of a site. We record the site&apos;s name, its owner, and any
          takedown by an operator, with who placed it and why.
        </li>
      </ul>

      <h2>This website</h2>
      <ul>
        <li>
          <strong>Aggregate page-view counts, measured by us.</strong> We record
          the page path, the hostname of the site that linked you here, any
          campaign tags in that link, and your country, in Cloudflare Analytics
          Engine. We do not record your IP address, do not set a cookie, and do
          not assign you a visitor or device identifier, so these counts cannot
          be traced to a person or linked across visits.
        </li>
        <li>
          <strong>
            Page views, measured by Google Analytics 4, but only if you agree.
          </strong>{' '}
          It sets cookies in your browser, assigns your browser a client
          identifier that recognizes it across pages and visits, and sends your
          IP address to Google to derive an approximate location. So we ask
          first, with a banner on your first visit, and unless and until you say
          yes we do not load it at all: nothing is requested from Google and
          nothing about your visit reaches them. We have not enabled Google
          Signals, advertising features, or any link to Google Ads, our code
          tells Google Analytics that advertising storage, the use of your data
          for advertising, and ad personalization are all refused, and we run no
          advertising scripts. The <strong>Cookie preferences</strong> link at
          the bottom of every page changes your answer at any time. Google
          Analytics runs only on vibld.com, never in the builder.
        </li>
        <li>
          <strong>Roadmap votes.</strong> When you vote on the roadmap, the site
          stores a random voter id in a first-party cookie your browser sends
          back but scripts cannot read. On our side we keep only a SHA-256 hash
          of that id, with your votes, in Cloudflare D1. Your IP address is
          hashed with a salt that changes every day and used only to limit how
          fast votes can be cast. The first vote from a browser is checked with
          Cloudflare Turnstile.
        </li>
        <li>
          <strong>Cloudflare Turnstile.</strong> Every page loads
          Cloudflare&apos;s Turnstile script, so loading a page contacts
          Cloudflare. It performs the anti-abuse check on a first roadmap vote,
          and we receive only whether the check passed.
        </li>
        <li>
          <strong>The waitlist.</strong> Before the beta opened, this site
          collected email addresses for a waitlist, stored with Resend, which
          also sends the emails to it. The form is gone. We use the list to send
          an email announcing the open beta, and after that to send occasional
          product news. Every email has an unsubscribe link, and we keep your
          address on the list until you unsubscribe. People who asked for access
          on the builder while it was invite-only are held by Clerk, and anyone
          we invited is on an invite list in our database.
        </li>
      </ul>

      <h2>Logs and security</h2>
      <p>
        Cloudflare, which hosts everything, sees each request&apos;s IP address,
        user agent and timing. We use IP addresses, without storing them, to
        rate-limit requests to the builder. Our servers&apos; logs, kept in
        Cloudflare&apos;s logging, record events such as a finished run with
        your account id, email address, model, tokens and cost, and billing and
        referral events with account ids. We do not deliberately log prompts or
        code. Cloudflare keeps these logs for 7 days.
      </p>

      <h2>How we use it</h2>
      <p>
        To run the Service: generating, storing, previewing, building,
        publishing and pushing your projects; billing you and enforcing your
        allowance; paying and reversing credit; preventing abuse; answering
        support requests; investigating reports; and keeping the Service secure.
        We use your email address to send you messages about your account and
        the Service. We may also send account holders occasional product news,
        through Resend, with an unsubscribe link in each one. Email about the
        Service, your billing and your account&apos;s security is sent whether
        or not you have unsubscribed. We do not sell personal information, and
        we do not share it with anyone for their own marketing.
      </p>

      <h2>Who receives it</h2>
      <p>
        The services that process data for us, and what each receives, are on
        our <a href="/legal/subprocessors">Subprocessors</a> page. Beyond them,
        we disclose information only with your consent or at your request, when
        the law requires it, to protect people or the Service, or as part of a
        sale or reorganisation of the business.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>
          <strong>Project files and run records</strong>: for as long as your
          account exists. They are deleted 30 days after you delete your
          account, as described below.
        </li>
        <li>
          <strong>Uploaded media</strong>: for as long as your account exists,
          unless you delete a file in the builder first, which removes it
          immediately.
        </li>
        <li>
          <strong>Published sites</strong>: the three most recent versions,
          until you take the site down, which deletes all of them. The
          site&apos;s name stays reserved to your account. A site an operator
          has taken down keeps its files so the decision can be reviewed or
          undone. Deleting your account takes your sites offline at once.
        </li>
        <li>
          <strong>Previews</strong>: the container and the copy of your project
          in it are discarded when the preview stops. A preview has a 30-minute
          lifetime and sleeps after 10 minutes without activity. A share link
          expires no later than the preview it points at.
        </li>
        <li>
          <strong>GitHub connections</strong>: 90 days, or until you disconnect.
          A disconnected connection is marked revoked rather than deleted, and
          the record is deleted with the rest of your account.
        </li>
        <li>
          <strong>Billing, credit and referral records</strong>: kept for
          accounting, including after your account is deleted, when they are
          kept without your name, email address or account id. Stripe keeps its
          own payment records. We keep these records for as long as tax and
          accounting law requires.
        </li>
        <li>
          <strong>Account deletion</strong>: you can delete your account
          yourself, from the builder&apos;s settings. From that moment the
          account cannot be used: any subscription is canceled at once, with no
          refund of the period already paid for; previews stop; published sites
          go offline; the GitHub connection is removed; unpaid referral rewards,
          on both sides of a referral, are canceled; and unused credit and
          allowance are forfeited, with no refund. 30 days later everything else
          is deleted: your projects and their history, uploaded media, your
          sites&apos; files, your GitHub connection history, your invitation,
          your usage records and your sign-in account. You can keep the account
          by signing in before then. Payment, subscription, credit and
          referral-payout records are kept for accounting, without your name,
          email address or account id, and a record that an account was deleted
          is kept for 12 months, without the account id. Stripe keeps its own
          payment records. Not deleted by vibld: the vibld GitHub App installed
          on your GitHub account, which is yours to remove; the preview
          service&apos;s records of the share links it issued; and finished
          generation runs, which Cloudflare Workflows keeps for 30 days after
          they finish.
        </li>
      </ul>

      <h2>Your choices</h2>
      <p>
        You can download your project or push it to GitHub at any time, delete
        uploaded media, take a published site down, revoke share links,
        disconnect GitHub, cancel a subscription in Stripe&apos;s billing
        portal, and delete your account. You can ask for access to, correction
        of, or deletion of your information by emailing{' '}
        <a href={`mailto:${SITE.emails.privacy}`}>{SITE.emails.privacy}</a>, and
        we will respond within 30 days.
      </p>

      <h2>Children</h2>
      <p>
        The Service is for adults (see our{' '}
        <a href="/legal/terms">Terms of Service</a>) and is not directed at
        children under 13. We do not knowingly collect information from them.
      </p>

      <h2>Where this applies</h2>
      <p>
        The Service is open to people anywhere in the world. Data is processed
        in the United States and wherever our subprocessors operate. Our
        database and file storage (Cloudflare D1 and R2) are in
        Cloudflare&apos;s Eastern North America location, in the United States.
      </p>
      <p>
        If you live somewhere with its own privacy law, for example the EU, the
        UK or California, you can use the rights described under Your choices
        (access, correction and deletion) in the same way, by emailing{' '}
        <a href={`mailto:${SITE.emails.privacy}`}>{SITE.emails.privacy}</a>. We
        do not sell personal information, and we do not share it for
        cross-context behavioural advertising.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We will update the &ldquo;Last updated&rdquo; date whenever this policy
        changes, and for material changes we will email account holders before
        the change takes effect.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or requests about this policy can be sent to{' '}
        <a href={`mailto:${SITE.emails.privacy}`}>{SITE.emails.privacy}</a> or
        to {SITE.legalEntity}, {SITE.mailingAddress}.
      </p>
    </LegalPage>
  );
}
