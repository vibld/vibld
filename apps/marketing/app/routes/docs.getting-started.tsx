import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, SITE, metaFor } from '../site';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'getting-started')!;
const CHECKED = '2026-09-16';

export function meta() {
  return metaFor('/docs/getting-started');
}

export default function GettingStarted() {
  return (
    <DocPage guide={GUIDE} updated={CHECKED}>
      <p>
        Vibld turns a description of an application into a real project: a
        conventional codebase in files you can read, running on a stack you
        already recognise. This page is the first twenty minutes.
      </p>

      <h2>1. Sign in</h2>
      <p>
        The builder is at{' '}
        <a href={SITE.appUrl} rel="noopener noreferrer">
          app.vibld.com
        </a>
        . Accounts are email and password or a linked provider, whichever you
        prefer. Nothing in the builder mounts until you are signed in, including
        the part that would start spending money on your behalf.
      </p>
      <p>
        A new account is granted <strong>$1.00 of model spend</strong> when it
        is created. That is a one-time grant and it does not reset. It is enough
        to build something small and see what the output looks like before
        deciding whether to pay for anything.
      </p>

      <h2>2. Describe what you want</h2>
      <p>
        The composer is the left column. Write what the thing is, who uses it,
        and what it has to do. Specifics help more than adjectives: “a booking
        page for a two-chair barbershop, with a week view and an email
        confirmation” produces a better first pass than “a modern booking app”.
      </p>
      <p>Three optional inputs sit above it, and all three persist:</p>
      <ul>
        <li>
          <strong>Knowledge</strong> is standing instructions. Anything you
          would otherwise repeat in every prompt belongs here: the company name,
          the stack you insist on, a rule about how dates are formatted.
        </li>
        <li>
          <strong>Style DNA</strong> is the visual direction, kept apart from
          the brief so that changing how it looks does not mean restating what
          it does.
        </li>
        <li>
          <strong>Reference URL</strong> points at a page to copy from or
          emulate. Vibld fetches it and reads its structure.
        </li>
      </ul>
      <p>
        You can also choose the model. Which models are offered depends on what
        the deployment can serve and on what your account is allowed, and the
        header always reports which one actually served the last run rather than
        which one was requested.
      </p>

      <h2>3. Read the checkpoint before accepting it</h2>
      <p>
        A run produces a <strong>staged checkpoint</strong>: a plan and a set of
        files, not yet the project. Nothing downstream, not the preview, not a
        push, not a publish, acts on staged files. Open the Code tab, read what
        it wrote, and accept it when it is right.
      </p>
      <p>
        Accepting is what makes a checkpoint the project. Iterating from there
        is another turn in the same conversation: the follow-up sees the project
        it is editing, so “make the header sticky” means the header it already
        wrote.
      </p>

      <h2>4. Run it for real</h2>
      <p>
        The preview you see first is a local mock assembled from the plan and
        the stylesheet. It runs nothing. When you want a genuinely installed,
        genuinely running copy, use <strong>Run in sandbox</strong>, which is
        covered in{' '}
        <a href="/docs/running-your-project">
          Running and sharing your project
        </a>
        .
      </p>

      <h2>What to read next</h2>
      <ul>
        <li>
          <a href="/docs/the-builder">The builder, pane by pane</a>, which is
          mostly about what each pane does <em>not</em> show.
        </li>
        <li>
          <a href="/docs/credits-and-plans">Credits and plans</a>, if you want
          to know what a run costs before you make several.
        </li>
        <li>
          <a href="/docs/taking-your-code">Taking your code with you</a>, which
          is the point of the whole exercise.
        </li>
      </ul>
    </DocPage>
  );
}
