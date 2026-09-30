import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, metaFor } from '../site';
import { FREE_PLAN } from '../plan-sources';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'the-builder')!;
const CHECKED = '2026-09-30';

export function meta() {
  return metaFor('/docs/the-builder');
}

export default function TheBuilder() {
  return (
    <DocPage guide={GUIDE} updated={CHECKED}>
      <h2>Preview</h2>
      <p>
        While a first build runs, this is a <strong>draft</strong>: a static
        sketch of the page, labeled “Draft, building the real site”, with the
        build’s progress over it. It is drawn in a restricted frame, is never
        saved in the project, and is a picture of the intent, not a run of it. A
        follow-up keeps what the tab already shows instead.
      </p>
      <p>
        Once there is code, the tab says <strong>Ready to run</strong> (or keeps
        the draft) and offers <strong>Run live preview</strong>, which installs
        the project and starts it in a private sandbox. Once it is up, the frame
        is the running app and the draft is gone: the two are never shown side
        by side.
      </p>
      <p>
        A running preview takes each new version in place, and says{' '}
        <strong>Updating preview…</strong> while it does. When it cannot, it is
        restarted and the tab says why. See{' '}
        <a href="/docs/running-your-project">
          Running and sharing your project
        </a>
        .
      </p>

      <h2>Code</h2>
      <p>
        The generated files, as files. While a build is being checked, the list
        is that build’s code, badged like the preview.
      </p>
      <p>
        Export, Publish and Push to GitHub are not here. They are under{' '}
        <strong>Ship</strong>, in the top bar, and they act on the{' '}
        <strong>last finished checkpoint</strong>. The tab says so when the list
        shows something else.
      </p>

      <h2>Console</h2>
      <p>
        Generation lifecycle events: what the run is doing, when it started,
        when it finished, what it cost.
      </p>
      <p>
        <strong>It is not the sandbox’s output.</strong> Sandbox execution is
        real, but its process output is not piped into this tab yet. If your
        project logs something at runtime, that log is in the sandbox, not here.
      </p>

      <h2>Problems</h2>
      <p>
        What vibld’s own checks found, including a build that failed its check
        or a run that failed.
      </p>
      <p>
        <strong>It is not the sandbox’s errors.</strong> Install failures, build
        failures and type errors from a sandbox run are not reported here yet. A
        sandbox that fails to start says so only in the Preview tab.
      </p>

      <h2>Runs</h2>
      <p>
        Every run on this project: the model, the tokens, the cost and why it
        ended. It is read back from storage, so it survives a reload and
        includes runs this tab never watched.
      </p>

      <h2>Projects</h2>
      <p>
        Everything is saved as you go: the code, the whole conversation, the
        style, the model, your instructions and preferences. The{' '}
        <strong>Projects</strong> list opens, renames, duplicates, archives and
        deletes projects. Deleting is permanent and asks first. A Free account
        can have {FREE_PLAN.activeProjects} active projects, and archived ones
        do not count; Build and Ship have no limit.
      </p>
      <p>
        With the same project open in two tabs, the one left behind is told
        “This project changed in another tab” and stops saving until you press{' '}
        <strong>Reload</strong>.
      </p>

      <h2>Sharing a project</h2>
      <p>
        <strong>Share</strong>, in the top bar, turns on a link of the form{' '}
        <code>app.vibld.com/s/&lt;token&gt;</code>. Anyone with it sees the
        project’s name, its code and its live preview, read-only; starting the
        live preview needs them to be signed in. Somebody signed in can{' '}
        <strong>Remix</strong> it: a copy of the code and settings in a new
        project of their own, called “Remix of” the original, with the media its
        code uses copied into their library. Your conversation, your name and
        your email are not shared. Turning the link off stops it working for
        good, and turning it on again makes a new one.
      </p>
      <p>
        This is not the same as a sandbox share link, which points at one
        running preview and never outlasts it.
      </p>

      <h2>Ship: publishing, and taking it back down</h2>
      <p>
        <strong>Publish</strong> puts the project’s last finished checkpoint on
        the web at its own address, <code>&lt;slug&gt;.vibld-preview.dev</code>,
        and anybody with the address can read it. Each project has its own site,
        and publishing one never replaces another’s. It takes two presses: the
        first names the site, the checkpoint and whether this replaces something
        already live, and the second is the act.
      </p>
      <p>
        Running a sandbox, or finishing a build, never makes anything public.
        Nothing automated can publish either: no scheduled run, no webhook, and
        no text in a pull request or a commit message.
      </p>
      <p>
        <strong>Take it down</strong> is the other half, on the same terms. The
        address stops working immediately and the files are deleted. The name
        stays yours: nobody else can claim it, and publishing again under it is
        what puts the site back. Deleting the project takes its site down too.
        Rolling back to a <em>previous</em> published checkpoint is not built
        yet.
      </p>
      <p>
        Published sites are sent a few safe default headers (HTTPS only, no
        content-type sniffing, a strict referrer policy, and no camera,
        microphone, location or payment features), and nothing that restricts
        what a page loads, so embeds and third-party scripts keep working.
        Images and fonts that the build itself emits are not published yet;
        files from your media library are.
      </p>

      <h2>The header and the footer</h2>
      <p>
        The header carries what you look at while building: the brand, then{' '}
        <strong>Projects</strong>, the project’s name (click it to rename), the
        save status, <strong>Share</strong> and <strong>Ship</strong>, then the
        light and dark toggle, the settings menu and your account.
      </p>
      <p>
        Everything that is configuration lives behind the gear: your plan and
        this period’s spend against your allowance, your referral link, the
        GitHub connection, deleting your account, and which provider and model
        served the last run. None of it claims anything before there has been a
        run.
      </p>
      <p>
        <strong>Delete account</strong> asks you to type a phrase to confirm.
        From then on the account cannot be used: any subscription is canceled,
        the preview stopped, published sites taken down and the GitHub
        connection removed. Thirty days later its projects, media and usage
        records are deleted. Until then, signing in offers{' '}
        <strong>Keep my account</strong>.
      </p>
      <p>
        The footer carries the limits above in one line, for anybody who never
        opens those tabs. The run count and token figures sit beside it, folded
        away until you ask for them.
      </p>

      <h2>Where this is going</h2>
      <p>
        The sandbox already produces the output and the errors; both gaps are
        about wiring them into these tabs. Until then, the tabs say so.
      </p>
    </DocPage>
  );
}
