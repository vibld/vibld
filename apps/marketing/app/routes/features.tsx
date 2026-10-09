import { Link } from 'react-router';
import { STYLE_PRESETS } from '@vibld/ai/style-presets';
import { STYLE_GALLERY_INDEX } from '@vibld/ai/style-gallery-index';

import { FeatureBento, SectionHead } from '../components/Sections';
import { PageHead } from '../components/SiteChrome';
import { faqSchema } from '../schema';
import { SITE, metaFor } from '../site';
import { FREE_PLAN } from '../plan-sources';
import { approxCount } from '../counts';

export function meta() {
  return [...metaFor('/features'), faqSchema(QUESTIONS)];
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
    title: 'It answers or it builds',
    body: 'For each message the agent either replies in words and changes nothing, or builds. Before the first build it may ask a question or two, and a “yes” becomes the full brief you agreed.',
  },
  {
    title: 'Style',
    body: 'A visual direction from the catalog, narrowed by mood. Styles whose moods your message names are marked as suggestions; nothing is picked for you.',
  },
  {
    title: 'Gallery',
    body: `One of ${approxCount(STYLE_GALLERY_INDEX.length)} complete styles: its colors, typefaces, type scale, corners and shadows are written into the site as tokens. Its colors can be edited, and an edit that breaks a contrast pair is not applied.`,
  },
  {
    title: 'Templates',
    body: 'A design from the template catalog as a starting point, by category and subcategory, the gallery styles among them. Its brief is added to your message, to edit or send.',
  },
  {
    title: 'Reference',
    body: 'A page to start from. vibld reads its text, colors, fonts and spacing and adapts them rather than copying. It goes with one message.',
  },
  {
    title: 'Media',
    body: 'Your images and video, placed where the request calls for them. One library per account, shared by every project.',
  },
  {
    title: 'Preferences',
    body: 'Project instructions and a few visual preferences, applied to every message, so you only say them once.',
  },
  {
    title: 'A choice of model',
    body: `Which models are offered depends on the deployment and your plan; Free builds with ${FREE_PLAN.models}. Beside Send, what a build on it is expected to cost, from the last 30 days of builds, or the most a build can cost until there are enough of them, plus the draft on a project's first build. The settings menu reports which one actually served the last run.`,
  },
];

const DIRECTIONS: Feature[] = [
  {
    title: 'Named styles',
    body: 'Pick a style and the build starts from its direction, including how it moves.',
  },
  {
    title: 'Three sketches',
    body: 'Show me three directions: three quick sketches that differ in look, for about a tenth of a build. Offered before the first build only.',
  },
  {
    title: 'Moving backgrounds',
    body: 'Ask for an animated background, or name one (aurora, particles, grain, flowing lines), and the build can use one of four that vibld writes itself: drawn in code from the project’s colors, paused off screen, and a still frame under reduced motion.',
  },
];

const PANES: Feature[] = [
  {
    title: 'Preview',
    body: 'While a first build runs, a draft of the page, labeled as one. Then Run live preview, and the frame is the running app.',
  },
  {
    title: 'Code',
    body: 'The generated files, as files, badged while a build is being checked. Export, Publish and Push are under Ship, in the top bar.',
  },
  {
    title: 'Console',
    body: 'What the run is doing, when it started and finished, and what it cost.',
    limit: 'Not the sandbox’s process output, which is not piped in yet.',
  },
  {
    title: 'Problems',
    body: 'What vibld’s own checks found, including a build that did not pass its check.',
    limit:
      'Not the sandbox’s install, build or type errors, which are not reported here yet.',
  },
  {
    title: 'History',
    body: 'The newest 100 checkpoints, any one restored in a single step. Nothing is deleted, so a restore can be undone too.',
  },
  {
    title: 'Runs',
    body: 'Every run on the project: the model, the tokens, the cost and why it ended.',
  },
];

const PROJECTS: Feature[] = [
  {
    title: 'Saved as you go',
    body: `The code, the whole conversation and the settings. Open, rename, duplicate, archive or delete from the Projects list. Free keeps ${FREE_PLAN.activeProjects} active projects; Build and Ship have no limit.`,
  },
  {
    title: 'Builds that outlast the page',
    body: 'Close the tab or lock the phone and the build carries on; reopening the project picks up the result. Only Cancel stops one, and it is charged for what it used.',
  },
  {
    title: 'Share and remix',
    body: 'Turn on a link and anyone with it sees the project’s code and live preview. Somebody signed in can remix it into a project of their own. Your conversation, name and email stay yours.',
  },
];

const OUT: Feature[] = [
  {
    title: 'Export',
    body: 'Downloads the checkpoint as a .zip: the files as they are, ready to open in an editor and run with the package manager the project declares. Nothing rewritten, nothing that phones home.',
  },
  {
    title: 'Push to GitHub',
    body: 'A branch named vibld/<revision>, one commit and a pull request against the default branch, in the project’s own repository: a new one vibld creates, or one you pick. The grant expires after 90 days, and a push is safe to retry.',
  },
  {
    title: 'Publish',
    body: 'Builds the checkpoint and serves it at the project’s own vibld-preview.dev address, in two presses. Take it down the same way: the address stops working immediately and the name stays yours.',
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
        lead="A request goes in, a conventional project comes out, and every step between is something you can read."
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
                Under the message box is a row of options, each opening its
                panel in place.{' '}
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
            title={`${approxCount(STYLE_PRESETS.length)} named styles, or three sketches`}
          />
          <FeatureGrid features={DIRECTIONS} />
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
            title="Shown early, checked, then the project"
            lede="There is no accept step. A build’s code is shown as soon as it exists, badged “Checking the build” while vibld installs and builds it, and “Fixing a problem” while a repair runs. Until the check ends, export, push and publish act on the last finished checkpoint. Iterating is another turn in the same conversation, and a follow-up changes only the files it needs."
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
            lede="Run live preview installs the dependencies and starts a dev server. It reports each state (queued, installing, starting, ready, failed) instead of a spinner, and it expires (ten idle minutes, thirty at most, one at a time), because it is for looking at a project rather than hosting one."
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
              <h3>It keeps up with the project</h3>
              <p>
                A running preview takes each new version in place and says
                “Updating preview…” while it does. A change to the dependencies
                is installed first; one it cannot take in place restarts the
                preview, and the tab says why.
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

      <section className="lb-section" aria-labelledby="projects-title">
        <div className="lb-wrap">
          <SectionHead
            number="05"
            eyebrow="Projects"
            id="projects-title"
            title="Each project keeps everything"
          />
          <FeatureGrid features={PROJECTS} />
        </div>
      </section>

      <section
        className="lb-section"
        id="checks"
        aria-labelledby="checks-title"
      >
        <div className="lb-wrap">
          <SectionHead
            number="06"
            eyebrow="Design checks"
            id="checks-title"
            title="It checks the build against its own spec"
            lede="The chosen direction is written into the project as DESIGN.md: its colors, type, breakpoints and motion. When the build finishes, static checks read the files against it, and against the few rules every page must keep: a page language, alt text on images, a reduced-motion rule. Checks read files; they do not render them, so they cannot see computed contrast or an overflowing layout."
          />
          <div className="lb-grid2">
            <article className="lb-card">
              <h3>Errors and warnings</h3>
              <p>
                An error is something the checker is confident about, such as a
                color the spec named that appears nowhere. Only errors buy a
                repair, because a repair is another paid call. A repair is a
                patch to the files at fault, not a rewrite, and a warning rides
                along with one that is happening anyway.
              </p>
            </article>
            <article className="lb-card">
              <h3>What it looks for</h3>
              <ul className="lb-taglist">
                {[
                  'color',
                  'font',
                  'type',
                  'breakpoint',
                  'motion',
                  'reduced-motion',
                  'canvas',
                  'lang',
                  'viewport',
                  'alt',
                  'label',
                  'media',
                  'copy',
                  'em-dash',
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
            number="07"
            eyebrow="Taking your code"
            id="out-title"
            title="Three ways out, and they do different things"
            lede="All three are under Ship, in the top bar. The output is a conventional project with no proprietary runtime, and it keeps building the day you stop paying."
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
            number="08"
            eyebrow="What you get"
            id="stack-title"
            title="A project you can read, run and move"
            lede={
              <>
                Plan and usage in the settings menu reads the same spend figures
                the builder enforces.{' '}
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
            number="09"
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
