import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, SITE, metaFor } from '../site';
import { FREE_PLAN } from '../plan-sources';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'getting-started')!;
const CHECKED = '2026-09-30';

export function meta() {
  return metaFor('/docs/getting-started');
}

export default function GettingStarted() {
  return (
    <DocPage guide={GUIDE} updated={CHECKED}>
      <p>
        vibld turns a description of an application into a real project: a
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
        vibld is in public beta, and anyone can sign up at{' '}
        <a href={SITE.signUpUrl} rel="noopener noreferrer">
          app.vibld.com/sign-up
        </a>
        . A new account can get <strong>$1.00 of model spend</strong> by adding
        a card: the <strong>Add a card</strong> button above the composer opens
        a Stripe page that saves the card and charges nothing. That is a
        one-time grant, one per account and one per card, and it does not reset.
        It is enough to build something small and see what the output looks like
        before deciding whether to pay for anything.
      </p>

      <h2>2. Describe what you want</h2>
      <p>
        The composer is the message box under the conversation. Write what the
        thing is, who uses it, and what it has to do. Specifics help more than
        adjectives: “a booking page for a two-chair barbershop, with a week view
        and an email confirmation” produces a better first pass than “a modern
        booking app”.
      </p>
      <p>
        Under the message is a row of options. Each opens a panel in place, and
        one that is set says so on its button:
      </p>
      <ul>
        <li>
          <strong>Style</strong> is a visual direction from the{' '}
          <a href="/styles">style catalogue</a>. A row of moods (luxe, calm,
          technical, organic, playful, brutal) narrows the list, and the styles
          whose moods your message names are listed as{' '}
          <strong>Suggested for your request</strong>. Nothing is picked for
          you. A moving background is asked for in the message instead: say
          “animated background”, or name one (aurora, particles, grain, flowing
          lines), and the build can use one of four that vibld draws in code
          from the project’s colours.
        </li>
        <li>
          <strong>Reference</strong> is the address of a page to start from.
          vibld reads its text, colours, fonts and spacing and adapts them
          rather than copying. It goes with the message it is sent with, and the
          field clears once that message is sent.
        </li>
        <li>
          <strong>Media</strong> is your images and video (JPEG, PNG, WebP,
          AVIF, GIF, MP4 or WebM), placed wherever your request calls for them.
          There is one library per account, shared by all your projects.
        </li>
        <li>
          <strong>Preferences</strong> holds{' '}
          <strong>Project instructions</strong>, anything you would otherwise
          repeat in every message (the company name, a rule about how dates are
          formatted), and <strong>Look</strong>, a few visual preferences. Both
          apply to every message, and what you type in a message wins.
        </li>
      </ul>
      <p>
        The model is the dropdown beside the send button. Which models are
        offered depends on the deployment and on your plan: a Free account
        builds with {FREE_PLAN.models} only. The settings menu, under{' '}
        <strong>This deployment</strong>, reports which model actually served
        the last run rather than which one was requested.
      </p>

      <h2>3. Talk to it, or have it build</h2>
      <p>
        The button says <strong>Generate</strong> for the first message and{' '}
        <strong>Send</strong> after that. For each message the agent either
        answers in words and changes nothing, or builds. Before the first build
        it may ask one or two questions, and a reply such as “yes” is turned
        into the full brief the two of you agreed, not sent on as the word.
      </p>
      <p>
        Before the first build there is also{' '}
        <strong>Show me three directions</strong>: three quick sketches that
        differ in look, for about a tenth of the cost of a build. Pick one and
        the build starts from it.
      </p>
      <p>
        There is no step where you accept a build. While a first build runs, the
        Preview tab shows a draft of the page, labelled as one. The code is
        shown as soon as it exists, badged <strong>Checking the build</strong>{' '}
        while vibld installs and builds it, and{' '}
        <strong>Fixing a problem</strong> while one repair runs. The badge goes
        when the check passes. <strong>Does not build</strong> means the check
        failed: that version is still your current one, and you can ask for a
        fix. <strong>Not checked</strong> means the check could not finish.
      </p>
      <p>
        A build keeps going if you close the tab, lock your phone or reload, and
        reopening the project picks up the result. Only <strong>Cancel</strong>{' '}
        stops it, and a cancelled build is charged for what it used up to that
        point.
      </p>
      <p>
        Iterating is another message in the same conversation. A follow-up sees
        the project it is editing, so “make the header sticky” means the header
        it already wrote, and it changes only the files it needs to.
      </p>

      <h2>4. Run it for real</h2>
      <p>
        Once something is built, the Preview tab offers{' '}
        <strong>Run live preview</strong>, which installs the project and starts
        it in a private sandbox so you can click through it. That is covered in{' '}
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
