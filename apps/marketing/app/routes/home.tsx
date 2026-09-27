import { Link } from 'react-router';
import type { StylePresetId } from '@vibld/ai/style-presets';

import {
  AskForm,
  Arrow,
  BuilderWindow,
  LiveBuild,
  useDemo,
} from '../components/LiveBuild';
import {
  FeatureBento,
  FlowList,
  FlowStepper,
  OpenFacts,
  PlanCards,
  PlanFacts,
  SectionHead,
  SignupCreditLine,
} from '../components/Sections';
import { SiteMiniature } from '../components/SiteMiniature';
import { UseCaseVisual } from '../components/UseCaseVisual';
import { catalogue } from '../catalogue';
import { DEMO_SITES, DEMO_SITE_IDS } from '../demo-sites';
import { lookById } from '../looks';
import { SITE, metaFor, organizationSchema } from '../site';
import { USE_CASES } from '../use-cases';

/**
 * The home page, in the "Live Build" direction Chris approved (2026-09-27):
 * a hero whose builder assembles a small site in front of the reader, then
 * the flow, the styles, what you get, the kinds of project, the plans, and
 * the way in.
 *
 * What changed on the way in from the mockup, beyond its colours and type
 * becoming the brand's:
 *
 * - The mockup rendered its builder from a script. Here the builder's
 *   finished state is the prerendered HTML, and the build only replays after
 *   hydration for a reader who has not asked for less motion. See
 *   `components/LiveBuild.tsx`.
 * - Its pricing showed "$10.00 / month" as if it were a price. The guide
 *   (`docs/credits-and-plans`) and the builder's source say it is model spend
 *   a plan includes, and the cards now say that, with the figures read from
 *   `apps/web` (see `plans.ts`).
 * - Its step two said the builder "sketches three directions" for every
 *   request. Sketching is something you ask for; `flow.ts` says so.
 * - Its closing call linked to itself. It held the real waitlist form until
 *   the open beta (Chris, 2026-09-27), and now links to the builder's
 *   sign-up form, since anybody can sign up.
 */

export function meta() {
  return [...metaFor('/'), organizationSchema()];
}

export default function Home() {
  return (
    <LiveBuild>
      <Hero />
      <HowItWorks />
      <Styles />
      <WhatYouGet />
      <UseCases />
      <Pricing />
      <Join />
    </LiveBuild>
  );
}

function Hero() {
  const words = SITE.tagline.split(' ');
  const last = words.pop();
  return (
    <section className="lb-hero" aria-labelledby="hero-title">
      <div className="lb-orbs" aria-hidden="true">
        <i className="lb-orb lb-orb--1" />
        <i className="lb-orb lb-orb--2" />
        <i className="lb-orb lb-orb--3" />
        <i className="lb-orb lb-orb--4" />
      </div>
      <div className="lb-waves" aria-hidden="true">
        <svg viewBox="0 0 1440 260" preserveAspectRatio="none">
          <path
            className="lb-waves__2"
            d="M0 150 C 180 80, 360 220, 540 150 S 900 80, 1080 150 S 1350 210, 1440 170"
          />
          <path
            className="lb-waves__1"
            d="M0 120 C 200 40, 380 200, 600 120 S 980 40, 1180 120 S 1400 170, 1440 140"
          />
          <path
            className="lb-waves__3"
            d="M0 190 C 220 130, 420 250, 660 190 S 1020 120, 1240 190 S 1400 220, 1440 200"
          />
        </svg>
      </div>
      <div className="lb-wrap">
        <div className="lb-hero__top">
          <p className="lb-kicker">
            <span className="lb-dot" aria-hidden="true" />
            {SITE.stage}
          </p>
          <h1 id="hero-title">
            {words.join(' ')} <span className="lb-hl">{last}</span>
          </h1>
          <p className="lb-hero__sub">
            Describe a site or an app. vibld can sketch three directions, writes
            a spec for the one you pick, builds a real React project, checks its
            own work, and hands you code you can read line by line.
          </p>
          <AskForm />
          <p className="lb-ask__note">
            A demonstration of the flow, drawn in this page. It does not call a
            model.{' '}
            <a className="lb-link" href={SITE.signUpUrl}>
              Sign up
            </a>{' '}
            to use the real thing.
          </p>
        </div>
        <BuilderWindow />
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="lb-section lb-band" aria-labelledby="how-title">
      <div className="lb-wrap">
        <SectionHead
          number="01"
          eyebrow="How it works"
          id="how-title"
          title="Seven steps, and you can see every one"
          lede="Each step leaves something behind you can look at: a spec, files, a check report, a preview. Nothing becomes public until you publish it yourself."
        />
        <FlowStepper />
        <FlowList />
        <p className="lb-more-link">
          <Link className="lb-link" to="/how-it-works">
            The flow, step by step
          </Link>
        </p>
      </div>
    </section>
  );
}

/** The styles the home page draws as tiles. The rest are on /styles. */
const HOME_TILES: readonly StylePresetId[] = [
  'glassmorphism',
  'brutalism',
  'aurora',
  'liquidGlass',
  'neumorphism',
  'retrowave',
  'editorial',
  'warmTerminal',
];

function Styles() {
  const { state, restyle } = useDemo();
  const entries = catalogue();
  const rest = entries.filter(
    (entry) => !HOME_TILES.includes(entry.id as StylePresetId),
  );
  return (
    <section className="lb-section" aria-labelledby="styles-title">
      <div className="lb-wrap">
        <SectionHead
          number="02"
          eyebrow="Styles"
          id="styles-title"
          title={`${entries.length} directions the builder actually knows`}
          lede="Ask for one by name, or ask for three sketches and pick. Each preset carries direction concrete enough to act on, including how it moves. Press a tile to re-skin the site in the builder above."
        />
        <ul className="lb-tiles">
          {HOME_TILES.map((id, index) => {
            const look = lookById(id);
            const entry = entries.find((candidate) => candidate.id === id)!;
            const site =
              DEMO_SITES[DEMO_SITE_IDS[index % DEMO_SITE_IDS.length]!];
            return (
              <li key={id}>
                <button
                  type="button"
                  className="lb-tile"
                  aria-pressed={state.look === id}
                  onClick={() => restyle(id)}
                >
                  <SiteMiniature
                    site={site}
                    look={look}
                    className="lb-tile__mini"
                  />
                  <span className="lb-tile__meta">
                    <span className="lb-tile__name">{entry.name}</span>
                    <span className="lb-tile__desc">{entry.description}</span>
                    <span className="lb-tile__act">
                      {state.look === id
                        ? 'On the builder now'
                        : 'Apply to the builder'}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="lb-note">
          Directions that are a surface treatment rather than a colour scheme
          are drawn in one neutral demonstration palette, because the builder
          leaves their colours to the project.
        </p>
        <div className="lb-morestyles">
          <p className="lb-morestyles__label">and {rest.length} more:</p>
          <ul>
            {rest.map((entry) => (
              <li key={entry.id}>
                {entry.name} <span>/ {entry.description}</span>
              </li>
            ))}
          </ul>
          <Link className="lb-link" to="/styles">
            See every style, drawn
          </Link>
        </div>
      </div>
    </section>
  );
}

function WhatYouGet() {
  return (
    <section className="lb-section" aria-labelledby="features-title">
      <div className="lb-wrap">
        <SectionHead
          number="03"
          eyebrow="What you get"
          id="features-title"
          title="A project you can read, run and move"
          lede="No proprietary format that only runs inside vibld, and no required runtime. The core is open source under Apache-2.0."
        />
        <FeatureBento />
        <p className="lb-more-link">
          <Link className="lb-link" to="/features">
            Everything the builder does today
          </Link>
        </p>
      </div>
    </section>
  );
}

function UseCases() {
  const { build } = useDemo();
  return (
    <section className="lb-section" aria-labelledby="uses-title">
      <div className="lb-wrap">
        <SectionHead
          number="04"
          eyebrow="Use cases"
          id="uses-title"
          title="Sites and apps, from one sentence"
          lede={
            <>
              Some starting points. The{' '}
              <Link className="lb-link" to="/examples">
                examples page
              </Link>{' '}
              shows real builds exactly as vibld generated them, with the prompt
              and no hand edits.
            </>
          }
        />
        <ul className="lb-uses">
          {USE_CASES.map((useCase) => (
            <li
              key={useCase.slug}
              className={`lb-use lb-use--${useCase.slug} lb-tint--${useCase.tint}`}
            >
              <UseCaseVisual demo={useCase.demo} />
              <div className="lb-use__b">
                <h3>
                  <Link to={`/use-cases/${useCase.slug}`}>{useCase.label}</Link>
                </h3>
                <p className="lb-use__q">{useCase.asks[0]}</p>
                <button
                  type="button"
                  className="lb-use__go"
                  onClick={() => build(useCase.demo)}
                >
                  Watch it build
                  <Arrow />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section className="lb-section" aria-labelledby="pricing-title">
      <div className="lb-wrap">
        <SectionHead
          number="05"
          eyebrow="Pricing"
          id="pricing-title"
          title="A price, and the model spend it includes"
          lede="Model spend is what actually costs money to run, so each plan comes with an amount of it every month. Free comes with some too."
        />
        <PlanCards />
        <PlanFacts />
        <p className="lb-more-link">
          <Link className="lb-link" to="/pricing">
            Plans and credit, in full
          </Link>
        </p>
      </div>
    </section>
  );
}

function Join() {
  return (
    <section className="lb-join" aria-labelledby="join-title">
      <div className="lb-wrap">
        <div className="lb-closing">
          <div className="lb-orbs" aria-hidden="true">
            <i className="lb-orb lb-orb--1" />
            <i className="lb-orb lb-orb--2" />
          </div>
          <p className="lb-kicker">
            <span className="lb-dot" aria-hidden="true" />
            {SITE.stage}
          </p>
          <h2 id="join-title">
            Describe it. <span className="lb-hl">Watch it build.</span>
          </h2>
          <p className="lb-closing__p">
            Anyone can sign up. <SignupCreditLine />
          </p>
          <p className="lb-closing__cta">
            <a className="button" href={SITE.signUpUrl}>
              Sign up
            </a>
          </p>
          <p className="lb-closing__row">
            Already have an account?{' '}
            <a href={SITE.appUrl} className="lb-link">
              Sign in
            </a>
            <span aria-hidden="true"> · </span>
            <a href={SITE.repoUrl} className="lb-link">
              Read the source on GitHub
            </a>
          </p>
          <OpenFacts />
          <p className="lb-closing__small">
            This page has no customer logos, reviews or user counts. The source
            is public, so you can read how vibld works before you trust it with
            anything.{' '}
            <Link className="lb-link" to="/legal/licenses">
              Open-source notices
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
