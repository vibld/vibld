import { Link } from 'react-router';

import { FLOW } from '../flow.ts';
import { FREE_PLAN, PLANS } from '../plan-sources.ts';
import { dollars, priceLabel } from '../plans.ts';
import { SITE } from '../site';

/**
 * Pieces of the Live Build design that more than one page shows: the home
 * page carries a short version of each, and the page it links to carries
 * the full one. Kept in one place so the two cannot come to say different
 * things about the same product.
 */

export function SectionHead({
  number,
  eyebrow,
  id,
  title,
  lede,
}: {
  number?: string;
  eyebrow: string;
  id: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
}) {
  return (
    <div className="lb-sechead">
      <div>
        <p className="lb-eyebrow">
          {number ? <b>{number}</b> : null}
          {eyebrow}
        </p>
        <h2 className="lb-h2" id={id}>
          {title}
        </h2>
      </div>
      {lede ? <p className="lb-lede">{lede}</p> : null}
    </div>
  );
}

/**
 * The seven steps as a wave of numbered stops. Each stop links to its step
 * on /how-it-works (or on the same page, when that is where it is drawn).
 */
export function FlowStepper({ onPage = false }: { onPage?: boolean }) {
  // One function draws the curve and places the stops, so a stop cannot sit
  // off the line it is meant to be on.
  const wave = (x: number) =>
    70 + 42 * Math.sin((2 * Math.PI * (x - 350)) / 720);
  const path = Array.from({ length: 121 }, (_, i) => {
    const x = i * 10;
    return `${i === 0 ? 'M' : 'L'}${x} ${wave(x).toFixed(1)}`;
  }).join(' ');
  const at = FLOW.map((_, index) => {
    const left = 5 + index * 15;
    return [left, (wave((left / 100) * 1200) / 140) * 100] as const;
  });
  return (
    <nav className="lb-wave" aria-label="The seven steps">
      <svg viewBox="0 0 1200 140" preserveAspectRatio="none" aria-hidden="true">
        <path className="lb-wave__base" d={path} />
        <path className="lb-wave__run" d={path} />
      </svg>
      <ol>
        {FLOW.map((step, index) => {
          const label = (
            <>
              <span className="lb-wave__n" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="lb-wave__t">
                <span className="sr-only">Step {index + 1}: </span>
                {step.short}
              </span>
            </>
          );
          return (
            <li
              key={step.id}
              style={{ left: `${at[index]![0]}%`, top: `${at[index]![1]}%` }}
              className={index % 4 < 2 ? 'is-up' : ''}
            >
              {/*
                A plain fragment link on the page itself. A `Link` to "#..."
                resolves against the route, which prerenders as
                "/how-it-works/", so every stop pointed at an address the
                host answers with a redirect.
              */}
              {onPage ? (
                <a href={`#step-${step.id}`}>{label}</a>
              ) : (
                <Link to={`/how-it-works#step-${step.id}`}>{label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The seven steps as a numbered list, one line of explanation each. */
export function FlowList() {
  return (
    <ol className="lb-flow-mini">
      {FLOW.map((step, index) => (
        <li key={step.id}>
          <span className="lb-flow-mini__n" aria-hidden="true">
            {String(index + 1).padStart(2, '0')}
          </span>
          <div>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

const STACK = [
  ['React 19', 'UI'],
  ['TypeScript', 'types'],
  ['Vite', 'build'],
  ['Tailwind v4', 'styles'],
  ['shadcn/ui', 'components'],
  ['Lucide', 'icons'],
  ['Motion', 'animation'],
] as const;

const CHECKS = [
  ['color', 'pass'],
  ['font', 'pass'],
  ['breakpoint', 'pass'],
  ['alt', 'pass'],
  ['reduced-motion', 'repaired'],
  ['lang', 'pass'],
] as const;

/** The "what you get" bento. Every card is a claim the guides make. */
export function FeatureBento() {
  return (
    <div className="lb-bento">
      <article className="lb-fb lb-fb--stack">
        <div className="lb-fb__top">
          <span className="lb-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 3l9 5-9 5-9-5z" />
              <path d="M3 13l9 5 9-5" />
            </svg>
          </span>
          <span className="lb-fb__k">Stack</span>
        </div>
        <h3>The stack a frontend developer already reads</h3>
        <p>
          It installs and builds with the package manager it declares. There is
          no vibld package in its dependencies and nothing that checks an
          account when it runs.
        </p>
        <ul className="lb-layers">
          {STACK.map(([name, role]) => (
            <li key={name}>
              {name}
              <span>{role}</span>
            </li>
          ))}
        </ul>
      </article>
      <article className="lb-fb lb-fb--checks">
        <div className="lb-fb__top">
          <span className="lb-ico lb-ico--mint" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 12.5l5 5L20 6.5" />
            </svg>
          </span>
          <span className="lb-fb__k">Design checks</span>
        </div>
        <h3>It checks the build against its own spec</h3>
        <p>
          Static checks read the files. Only an error the checker is sure of
          buys a repair, because a repair is another paid call. It patches the
          files at fault rather than rewriting the project.
        </p>
        <ul className="lb-chk" aria-label="An example check report">
          {CHECKS.map(([name, result]) => (
            <li key={name}>
              <b>{name}</b>
              <span className={result === 'pass' ? 'is-ok' : 'is-fixed'}>
                {result}
              </span>
            </li>
          ))}
        </ul>
      </article>
      <article className="lb-fb lb-fb--gh">
        <div className="lb-fb__top">
          <span className="lb-ico lb-ico--sky" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="6" cy="6" r="2.5" />
              <circle cx="6" cy="18" r="2.5" />
              <circle cx="18" cy="12" r="2.5" />
              <path d="M6 8.5v7M8.5 6h4a3 3 0 0 1 3 3v.5" />
            </svg>
          </span>
          <span className="lb-fb__k">GitHub</span>
        </div>
        <h3>Push opens a pull request</h3>
        <p>
          In the project’s own repository, created or picked on its first push,
          on a vibld/ branch, against your default branch. Review it like any
          other change.
        </p>
        <div className="lb-pr">
          <p className="lb-pr__t">
            <i aria-hidden="true" />
            vibld: &lt;revision&gt;
          </p>
          <p className="lb-pr__m">
            your-org/clay-saturdays, from vibld/&lt;revision&gt;
          </p>
        </div>
      </article>
      <article className="lb-fb lb-fb--pub">
        <div className="lb-fb__top">
          <span className="lb-ico lb-ico--sun" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
            </svg>
          </span>
          <span className="lb-fb__k">Publishing</span>
        </div>
        <h3>Two presses to go live, and the same to take it down</h3>
        <p>
          Nothing automated can publish: no scheduled run, no webhook, no text
          in a commit. Take it down and the address stops working immediately,
          and the name stays yours.
        </p>
        <div className="lb-pubrow">
          <p className="lb-url">
            <b>clay-saturdays</b>.vibld-preview.dev
          </p>
          <p
            className="lb-press"
            aria-label="Two presses: name it, then publish"
          >
            <span>Name it</span>
            <span>Publish</span>
          </p>
        </div>
      </article>
      <article className="lb-fb lb-fb--self">
        <div className="lb-self">
          <div>
            <div className="lb-fb__top">
              <span className="lb-ico lb-ico--rose" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="6" rx="2" />
                  <rect x="3" y="14" width="18" height="6" rx="2" />
                  <path d="M7 7h.01M7 17h.01" />
                </svg>
              </span>
              <span className="lb-fb__k">Self-hosting</span>
            </div>
            <h3>Run the whole builder yourself</h3>
            <p>
              The source is public. Self-hosted, vibld is three Cloudflare
              Workers with deliberately different blast radii, so the code a
              model wrote never runs next to your provider keys.
            </p>
            <p>
              <Link className="lb-link" to="/docs/self-hosting">
                What self-hosting involves
              </Link>
            </p>
          </div>
          <ul className="lb-dia" aria-label="The three Workers">
            <li>
              <b>Builder</b>
              <span>interface, API, spend ledger</span>
            </li>
            <li>
              <b>Sandbox</b>
              <span>installs and runs generated code</span>
            </li>
            <li>
              <b>Publish</b>
              <span>serves published builds</span>
            </li>
          </ul>
        </div>
      </article>
    </div>
  );
}

/**
 * The three plans, with the figures read from the builder's source by
 * `plan-sources.ts`. Each card states two different numbers and labels both:
 * the price a subscription charges, and the model spend it includes each
 * month. The second used to stand alone, and read as the first.
 */
export function PlanCards({ headingLevel = 3 }: { headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <ul className="lb-plans">
      {PLANS.plans.map((plan) => (
        <li key={plan.id} className="lb-plan">
          <Heading className="lb-plan__n">{plan.name}</Heading>
          <p className="lb-plan__p">
            {plan.price ? priceLabel(plan.price.monthly) : '$0'}
            <small>{plan.price ? 'a month' : 'no subscription'}</small>
          </p>
          <p className="lb-plan__alt">
            {plan.price
              ? `or ${priceLabel(plan.price.annual)} a year${monthsFree(plan.price)}`
              : `${dollars(PLANS.freeTrialCents)} to try it without a card${signupGrant()}`}
          </p>
          <p className="lb-plan__spend">
            <b>{dollars(plan.monthlyCents)}</b> of model spend included each
            month{plan.price ? '' : ' once a card is saved'}
          </p>
          <p className="lb-plan__d">
            {plan.price
              ? 'Upgrading starts a Stripe Checkout session. Cancel plan is in the builder’s settings menu; cards and invoices are in Stripe’s billing portal.'
              : `An account with no active subscription is Free. It builds with ${FREE_PLAN.models} and keeps up to ${FREE_PLAN.activeProjects} active projects.`}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * The new-account grant, with its condition, as a trailing phrase: ", plus
 * $1.00 once, when a new account adds a card". The condition comes from the
 * builder's source (`PLANS.signupRequiresCard`), so no page can promise the
 * dollar on sign-up alone while the builder waits for a card (Chris,
 * 2026-09-27). Nothing while the grant is retired (D163: zero cents).
 */
function signupGrant(): string {
  if (PLANS.signupCents <= 0) return '';
  return PLANS.signupRequiresCard
    ? `, plus ${dollars(PLANS.signupCents)} once, when a new account adds a card`
    : `, plus ${dollars(PLANS.signupCents)} once, on a new account`;
}

/** How a new account starts, as a sentence, for the home page's way in. */
export function SignupCreditLine() {
  if (PLANS.signupCents > 0) {
    return (
      <>
        {PLANS.signupRequiresCard
          ? `Add a card and get ${dollars(PLANS.signupCents)} of build credit. The card is saved, not charged.`
          : `A new account gets ${dollars(PLANS.signupCents)} of build credit.`}
      </>
    );
  }
  const free = PLANS.plans.find((plan) => !plan.price);
  return (
    <>
      {`A new account gets ${dollars(PLANS.freeTrialCents)} of model spend to try it, and ${dollars(free?.monthlyCents ?? 0)} a month once a card is saved. The card is saved, not charged.`}
    </>
  );
}

/**
 * ", two months free", worked out from the two prices rather than asserted,
 * so the phrase goes away by itself if the prices stop saying it.
 */
function monthsFree(price: { monthly: number; annual: number }): string {
  const months = 12 - price.annual / price.monthly;
  const words = ['', 'one', 'two', 'three'];
  return Number.isInteger(months) && months > 0 && words[months]
    ? `, ${words[months]} month${months === 1 ? '' : 's'} free`
    : '';
}

/** The four facts about credit the guide states, in one strip. */
export function PlanFacts() {
  return (
    <dl className="lb-facts">
      <div>
        <dt>New accounts</dt>
        <dd>
          {`A Free account without a card has ${dollars(PLANS.freeTrialCents)} of model spend once, to try it. Saving a card (saved, not charged) starts the Free plan’s monthly allowance, once per card.${PLANS.signupCents > 0 ? ' ' : ''}`}
          {PLANS.signupCents <= 0
            ? ''
            : PLANS.signupRequiresCard
              ? `Add a card and get ${dollars(PLANS.signupCents)} of model spend once. The card is saved, not charged. One grant per account and per card, separate from the monthly allowance, and it expires twelve months after it is granted.`
              : `Granted ${dollars(PLANS.signupCents)} once, separate from the monthly allowance. It expires twelve months after it is granted.`}
        </dd>
      </div>
      <div>
        <dt>Resets</dt>
        <dd>On the UTC calendar month, for everyone.</dd>
      </div>
      <div>
        <dt>Top-ups</dt>
        <dd>
          {priceLabel(PLANS.topup.priceCents)} adds{' '}
          {dollars(PLANS.topup.creditCents)} of model spend, on any plan, used
          only once the allowance is gone. It expires twelve months after
          purchase.
        </dd>
      </div>
      <div>
        <dt>Per run</dt>
        <dd>
          Reserves its worst case up front, then you are charged what it
          actually cost.
        </dd>
      </div>
    </dl>
  );
}

/** What anyone can verify today without an account. */
export const OPEN_FACTS = [
  { term: 'License', detail: 'Apache-2.0, for the core' },
  { term: 'Source', detail: 'Public on GitHub' },
  { term: 'Output', detail: 'Plain files in a standard Vite layout' },
  { term: 'Runtime', detail: 'None required from vibld' },
];

export function OpenFacts() {
  return (
    <dl className="lb-open">
      {OPEN_FACTS.map((fact) => (
        <div key={fact.term}>
          <dt>{fact.term}</dt>
          <dd>{fact.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export function GitHubLink({ children }: { children: React.ReactNode }) {
  return (
    <a href={SITE.repoUrl} className="button button--secondary">
      {children}
    </a>
  );
}
