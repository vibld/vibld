import { Link } from 'react-router';

import { LockIcon } from '../components/LiveBuild';
import { FlowStepper } from '../components/Sections';
import { PageHead } from '../components/SiteChrome';
import { FLOW } from '../flow';
import type { FlowStep } from '../flow';
import { SITE, metaFor } from '../site';

export function meta() {
  return metaFor('/how-it-works');
}

/**
 * The flow from a request to a project you own, drawn one step at a time.
 *
 * The words are `flow.ts`, which names the guide each step was checked
 * against. The drawings beside them are illustrations and say so: the
 * pottery studio is invented, and no build was captured for them.
 */
export default function HowItWorks() {
  return (
    <>
      <PageHead
        eyebrow="How it works"
        title="From a sentence to a project you own"
        lead="Seven steps. Each one leaves something you can look at before the next one starts, and nothing becomes public until you publish it yourself."
      >
        <p className="lb-honest">
          <PencilIcon />
          Drawn to show the flow. The pottery studio is an invented example.
        </p>
      </PageHead>
      <section className="lb-section lb-band" aria-label="The seven steps">
        <div className="lb-wrap">
          <FlowStepper onPage />
          <ol className="lb-flow">
            {FLOW.map((step, index) => (
              <li className="lb-step" id={`step-${step.id}`} key={step.id}>
                <span className="lb-step__n" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <h2>
                    <span className="sr-only">Step {index + 1}: </span>
                    {step.title}
                  </h2>
                  <p>{step.body}</p>
                  <p className="lb-step__doc">
                    Checked against{' '}
                    <Link className="lb-link" to={step.doc.href}>
                      {step.doc.label}
                    </Link>
                  </p>
                </div>
                <div className="lb-art">
                  <StepArt step={step} />
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="lb-section" aria-labelledby="after-title">
        <div className="lb-wrap lb-after">
          <h2 className="lb-h2" id="after-title">
            And after the first build
          </h2>
          <div className="lb-after__cols">
            <div>
              <h3>Iterate in the same conversation</h3>
              <p>
                A follow-up sees the project it is editing, so “make the header
                sticky” means the header it already wrote. Every change is
                another staged checkpoint to read and accept.
              </p>
            </div>
            <div>
              <h3>Restart the sandbox to see it</h3>
              <p>
                A running sandbox keeps serving the checkpoint it started from,
                and says so when a newer one is accepted, rather than quietly
                becoming something else.
              </p>
            </div>
            <div>
              <h3>Take it with you whenever</h3>
              <p>
                Export and push act on the last accepted checkpoint. The project
                owes nothing to your account once it is out.
              </p>
            </div>
          </div>
          <p className="lb-after__cta">
            <a className="button" href={SITE.signUpUrl}>
              Sign up
            </a>
            <a className="lb-link" href={SITE.appUrl}>
              Sign in
            </a>
            <Link className="lb-link" to="/docs/getting-started">
              Read Getting started
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}

function PencilIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M2 12.5L11 3.5l1.5 1.5-9 9H2z" />
    </svg>
  );
}

/** One illustration per step. Invented content, drawn in the brand's inks. */
function StepArt({ step }: { step: FlowStep }) {
  switch (step.id) {
    case 'prompt':
      return (
        <figure className="lb-promptbox">
          <p>
            A site for my Saturday wheel-throwing classes. People pick a
            two-hour slot and see a confirmation.
          </p>
          <figcaption className="lb-promptbox__foot">
            <span className="lb-urlfield">Reference URL (optional)</span>
            <span className="lb-urlfield">
              Style DNA: calm, let the pots speak
            </span>
          </figcaption>
        </figure>
      );
    case 'directions':
      return (
        <figure>
          <figcaption className="lb-art__h">
            <span>3 mockups</span>
            <span>direction A chosen</span>
          </figcaption>
          <ul className="lb-thumbs">
            <li className="is-chosen">
              <span className="lb-thumb__view lb-thumb--a" aria-hidden="true">
                <i className="h" />
                <i className="p" />
                <i className="b" />
                <i className="m" />
              </span>
              <span className="lb-thumb__cap">
                <b>A</b> Calm studio
              </span>
            </li>
            <li>
              <span className="lb-thumb__view lb-thumb--b" aria-hidden="true">
                <span className="s">The Wheel</span>
                <i className="r" />
              </span>
              <span className="lb-thumb__cap">
                <b>B</b> Serif
              </span>
            </li>
            <li>
              <span className="lb-thumb__view lb-thumb--c" aria-hidden="true">
                <i className="b1" />
                <i className="b2" />
                <i className="b3" />
              </span>
              <span className="lb-thumb__cap">
                <b>C</b> Blocks
              </span>
            </li>
          </ul>
        </figure>
      );
    case 'spec':
      return (
        <dl className="lb-spec">
          <div>
            <dt>palette</dt>
            <dd>
              <span className="lb-sw">
                <i style={{ background: '#E8EEEB' }} />
                #E8EEEB
              </span>
              <span className="lb-sw">
                <i style={{ background: '#16292A' }} />
                #16292A
              </span>
              <span className="lb-sw">
                <i style={{ background: '#1F6F6B' }} />
                #1F6F6B
              </span>
            </dd>
          </div>
          <div>
            <dt>type</dt>
            <dd>display grotesk / readable sans body</dd>
          </div>
          <div>
            <dt>breakpoints</dt>
            <dd>phone, tablet, desktop</dd>
          </div>
          <div>
            <dt>motion</dt>
            <dd>short ease-out; honours reduced motion</dd>
          </div>
        </dl>
      );
    case 'build':
      return (
        <div>
          <ul className="lb-stack" aria-label="The stack">
            {[
              'React 19',
              'TypeScript',
              'Vite',
              'Tailwind v4',
              'shadcn/ui',
              'Lucide',
              'Motion',
            ].map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <pre
            className="lb-tree"
            tabIndex={0}
            aria-label="The project's files"
          >
            <span className="lb-t-tag">clay-saturdays/</span>
            {'\n  package.json\n  index.html\n  DESIGN.md\n  '}
            <span className="lb-t-tag">src/</span>
            {'\n    main.tsx  App.tsx  index.css\n    '}
            <span className="lb-t-tag">components/</span>
            {'\n      SlotPicker.tsx  Confirmation.tsx'}
          </pre>
        </div>
      );
    case 'checks':
      return (
        <pre
          className="lb-term"
          tabIndex={0}
          aria-label="An example check report"
        >
          <span className="lb-t-comment">design checks against DESIGN.md</span>
          {'\n'}
          <span className="lb-t-ok">pass</span>
          {'  color           #1F6F6B found in src/index.css\n'}
          <span className="lb-t-ok">pass</span>
          {'  font            display face is loaded\n'}
          <span className="lb-t-ok">pass</span>
          {'  alt             every image has alt text\n'}
          <span className="lb-t-bad">error</span>
          {' reduced-motion  no prefers-reduced-motion rule\n'}
          <span className="lb-t-note">repair</span>
          {' one pass, whole project\n'}
          <span className="lb-t-ok">pass</span>
          {'  reduced-motion  rule added in src/index.css\n'}
          <span className="lb-t-ok">clean</span>
          {' 0 errors'}
        </pre>
      );
    case 'preview':
      return (
        <div className="lb-browser">
          <p className="lb-browser__bar">
            <LockIcon />
            <span className="lb-browser__url">sandbox preview, only you</span>
          </p>
          <div className="lb-browser__view" aria-hidden="true">
            <div>
              <span className="h">Throw your first pot this weekend.</span>
              <span className="b">Pick a slot</span>
            </div>
            <span className="m" />
          </div>
        </div>
      );
    case 'ship':
      return (
        <div className="lb-ship">
          <div>
            <h3>Publish</h3>
            <p>
              Two presses: the first names the site and the checkpoint, the
              second is the act.
            </p>
            <code>clay-saturdays.vibld-preview.dev</code>
          </div>
          <div>
            <h3>Push to GitHub</h3>
            <p>A pull request in the one repository you approved.</p>
            <code>vibld/&lt;revision&gt;: pull request opened</code>
          </div>
          <div>
            <h3>Export</h3>
            <p>The accepted checkpoint as an archive, nothing rewritten.</p>
            <code>clay-saturdays.zip</code>
          </div>
        </div>
      );
    default:
      return null;
  }
}
