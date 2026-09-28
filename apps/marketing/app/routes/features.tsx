import { Link } from 'react-router';
import { STYLE_PRESETS } from '@vibld/ai/style-presets';

import { FeatureBento, SectionHead } from '../components/Sections';
import { PageHead } from '../components/SiteChrome';
import { SITE, metaFor } from '../site';

export function meta() {
  return metaFor('/features');
}

/**
 * What the builder does today, one claim per card.
 *
 * Every card here was checked against a guide, and says where a feature
 * stops as well as what it does, because the guides do: the Console is not
 * the sandbox's output, the Problems pane is not the sandbox's errors, and a
 * rollback to an earlier publish is not built yet. A features page that left
 * those out would be the one place on the site that claimed more than the
 * product has.
 */

interface Feature {
  title: string;
  body: string;
  /** Where the feature stops, when the guide says so. */
  limit?: string;
}

const COMPOSER: Feature[] = [
  {
    title: 'A request in plain words',
    body: 'Write what the thing is, who uses it and what it has to do. Specifics help more than adjectives.',
  },
  {
    title: 'Knowledge',
    body: 'Standing instructions that persist: the company name, a stack you insist on, how dates are formatted.',
  },
  {
    title: 'Style DNA',
    body: 'The visual direction, kept apart from the brief, so changing how it looks does not mean restating what it does.',
  },
  {
    title: 'Reference URL',
    body: 'A page to copy from or emulate. vibld fetches it and reads its structure.',
  },
  {
    title: 'A choice of model',
    body: 'Which models are offered depends on the deployment and your account. The settings menu reports which one actually served the last run.',
  },
];

const PANES: Feature[] = [
  {
    title: 'Preview',
    body: 'Until a sandbox runs, a local mock of the plan in a fully restricted frame: nothing installed, no generated code executed. Once a sandbox runs, the frame is the sandbox.',
  },
  {
    title: 'Code',
    body: 'The generated files, as files. The pane to read before accepting anything.',
  },
  {
    title: 'Console',
    body: 'What the run is doing, when it started and finished, and what it cost.',
    limit: 'Not the sandbox’s process output, which is not piped in yet.',
  },
  {
    title: 'Problems',
    body: 'What vibld’s own checks found in the staged files before you accepted them.',
    limit:
      'Not the sandbox’s install, build or type errors, which are not reported here yet.',
  },
];

const OUT: Feature[] = [
  {
    title: 'Export',
    body: 'Downloads the accepted checkpoint as a .zip: the files as they are, ready to open in an editor and run with the package manager the project declares. Nothing rewritten, nothing that phones home.',
  },
  {
    title: 'Push to GitHub',
    body: 'A branch named vibld/<revision>, one commit and a pull request against the default branch, in the single repository you approved. The grant expires after 90 days, and a push is safe to retry.',
  },
  {
    title: 'Publish',
    body: 'Builds the accepted checkpoint and serves it at a vibld address, in two presses. Take it down the same way: the address stops working immediately and the name stays yours.',
    limit: 'Rolling back to a previous published checkpoint is not built yet.',
  },
];

const QUESTIONS = [
  {
    question: 'Can I take the project somewhere else?',
    answer:
      'Yes. Export downloads it as an archive: package.json, index.html, a src directory and a README. Push to GitHub opens a pull request in a repository you connect. From there it goes wherever you put it.',
  },
  {
    question: 'Does it need vibld to run?',
    answer:
      'No. It installs and builds with the package manager it declares, npm install and npm run build. There is no vibld package in its dependencies and nothing that checks an account when it runs.',
  },
  {
    question: 'Will I be able to read the code?',
    answer:
      'It writes React, TypeScript and Vite, styled with Tailwind and shadcn/ui components, with Lucide icons and Motion for animation. A frontend developer can review it without learning a new format first.',
  },
  {
    question: 'What if vibld shuts down?',
    answer:
      'Projects you have exported or pushed keep working, because none of them call home. The core is licensed Apache-2.0, so anyone with a copy of the source can keep reading, running and forking it.',
  },
];

export default function Features() {
  return (
    <>
      <PageHead
        eyebrow="Features"
        title="What the builder does today"
        lead="A request goes in, a conventional project comes out, and every step between is something you can read. This is the whole of it, including where each part stops."
      />

      <section
        className="lb-section lb-section--tight"
        aria-labelledby="composer-title"
      >
        <div className="lb-wrap">
          <SectionHead
            number="01"
            eyebrow="The composer"
            id="composer-title"
            title="Say it once, keep it"
            lede={
              <>
                Three optional inputs sit above the request, and all three
                persist.{' '}
                <Link className="lb-link" to="/docs/getting-started">
                  Getting started
                </Link>{' '}
                walks through them.
              </>
            }
          />
          <FeatureGrid features={COMPOSER} />
        </div>
      </section>

      <section className="lb-section" aria-labelledby="directions-title">
        <div className="lb-wrap">
          <SectionHead
            number="02"
            eyebrow="Directions"
            id="directions-title"
            title={`${STYLE_PRESETS.length} named styles, or three sketches`}
            lede="Name a style preset and the build starts from its direction, including how it moves. Or ask for three sketches that differ in look, and pick one."
          />
          <p className="lb-more-link">
            <Link className="lb-link" to="/styles">
              Every style, drawn
            </Link>
          </p>
        </div>
      </section>

      <section className="lb-section" aria-labelledby="checkpoints-title">
        <div className="lb-wrap">
          <SectionHead
            number="03"
            eyebrow="Checkpoints"
            id="checkpoints-title"
            title="Nothing acts on files you have not accepted"
            lede="A run produces a staged checkpoint: a plan and a set of files, not yet the project. The preview, a push and a publish all act on the last one you accepted. Iterating is another turn in the same conversation, and the follow-up sees the project it is editing."
          />
          <FeatureGrid features={PANES} />
          <p className="lb-more-link">
            <Link className="lb-link" to="/docs/the-builder">
              The builder, pane by pane
            </Link>
          </p>
        </div>
      </section>

      <section className="lb-section" aria-labelledby="sandbox-title">
        <div className="lb-wrap">
          <SectionHead
            number="04"
            eyebrow="Sandbox and sharing"
            id="sandbox-title"
            title="A real, installed, running copy"
            lede="Run live preview installs the dependencies and starts a dev server. It reports each state (queued, installing, starting, ready, failed) instead of a spinner, and it expires, because it is for looking at a project rather than hosting one."
          />
          <div className="lb-grid2">
            <article className="lb-card">
              <h3>Share links you can take back</h3>
              <p>
                Share mints a link to the running sandbox. Several can be live
                at once, each with its own expiry and each revoked on its own,
                and none is affected by restarting or stopping the sandbox.
              </p>
              <p className="lb-card__warn">
                Anyone with the link can view the running app and everything it
                shows, until it is revoked or expires. The builder says so next
                to the button.
              </p>
            </article>
            <article className="lb-card">
              <h3>It says when it is out of date</h3>
              <p>
                A sandbox serves the checkpoint it started from. Accept a newer
                one and the pane says so and offers Restart, rather than letting
                the frame quietly misrepresent the project.
              </p>
              <p>
                <Link className="lb-link" to="/docs/running-your-project">
                  Running and sharing your project
                </Link>
              </p>
            </article>
          </div>
        </div>
      </section>

      <section
        className="lb-section"
        id="checks"
        aria-labelledby="checks-title"
      >
        <div className="lb-wrap">
          <SectionHead
            number="05"
            eyebrow="Design checks"
            id="checks-title"
            title="It checks the build against its own spec"
            lede="The chosen direction is written into the project as DESIGN.md: its colours, type, breakpoints and motion. When the build finishes, static checks read the files against it, and against the few rules every page must keep: a page language, alt text on images, a reduced-motion rule. Checks read files; they do not render them, so they cannot see computed contrast or an overflowing layout."
          />
          <div className="lb-grid2">
            <article className="lb-card">
              <h3>Errors and warnings</h3>
              <p>
                An error is something the checker is confident about, such as a
                colour the spec named that appears nowhere. Only errors buy a
                repair, because a repair is a paid call that rewrites the whole
                project. A warning rides along with a repair that is happening
                anyway.
              </p>
            </article>
            <article className="lb-card">
              <h3>What it looks for</h3>
              <ul className="lb-taglist">
                {[
                  'color',
                  'font',
                  'breakpoint',
                  'lang',
                  'alt',
                  'label',
                  'reduced-motion',
                  'viewport',
                ].map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section className="lb-section" aria-labelledby="out-title">
        <div className="lb-wrap">
          <SectionHead
            number="06"
            eyebrow="Taking your code"
            id="out-title"
            title="Three ways out, and they do different things"
            lede="The output is a conventional project. There is no proprietary runtime to keep it working and nothing that stops building the day you stop paying."
          />
          <FeatureGrid features={OUT} />
          <p className="lb-more-link">
            <Link className="lb-link" to="/docs/taking-your-code">
              Taking your code with you
            </Link>
          </p>
        </div>
      </section>

      <section className="lb-section" aria-labelledby="stack-title">
        <div className="lb-wrap">
          <SectionHead
            number="07"
            eyebrow="What you get"
            id="stack-title"
            title="A project you can read, run and move"
            lede={
              <>
                Plan and usage in the settings menu mirrors the same spend
                figures the builder enforces, so what it shows and what it
                allows cannot disagree.{' '}
                <Link className="lb-link" to="/pricing">
                  Pricing
                </Link>{' '}
                has the plans.
              </>
            }
          />
          <FeatureBento />
        </div>
      </section>

      <section className="lb-section" aria-labelledby="questions-title">
        <div className="lb-wrap">
          <SectionHead
            number="08"
            eyebrow="Before you join"
            id="questions-title"
            title="Questions worth asking first"
          />
          <ul className="lb-grid2">
            {QUESTIONS.map((item) => (
              <li key={item.question} className="lb-card">
                <h3>{item.question}</h3>
                <p>{item.answer}</p>
              </li>
            ))}
          </ul>
          <p className="lb-after__cta">
            <a className="button" href={SITE.signUpUrl}>
              Sign up
            </a>
            <a className="lb-link" href={SITE.appUrl}>
              Sign in
            </a>
            <a className="lb-link" href={SITE.repoUrl}>
              Read the source on GitHub
            </a>
          </p>
        </div>
      </section>
    </>
  );
}

function FeatureGrid({ features }: { features: Feature[] }) {
  return (
    <ul className="lb-grid3">
      {features.map((feature) => (
        <li key={feature.title} className="lb-card">
          <h3>{feature.title}</h3>
          <p>{feature.body}</p>
          {feature.limit ? (
            <p className="lb-card__limit">
              <span>Where it stops:</span> {feature.limit}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
