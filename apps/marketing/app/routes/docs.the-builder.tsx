import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, metaFor } from '../site';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'the-builder')!;
const CHECKED = '2026-09-17';

export function meta() {
  return metaFor('/docs/the-builder');
}

export default function TheBuilder() {
  return (
    <DocPage guide={GUIDE} updated={CHECKED}>
      <p>
        Four panes, and the useful half of this page is what each one does not
        show. A pane that looks like it reports everything, and reports some of
        it, is worse than one that says where it stops.
      </p>

      <h2>Preview</h2>
      <p>
        Until you start a sandbox, this is a <strong>local mock</strong>: static
        HTML assembled from the accepted plan and stylesheet, rendered in a
        fully restricted frame. No dependencies are installed and no generated
        code is executed. It is a picture of the intent, not a run of the
        project.
      </p>
      <p>
        Once a sandbox is running, the frame is the sandbox and the mock is
        gone. The two are never shown side by side, because a stale mock next to
        a live copy of the same project invites exactly the wrong conclusion
        about which one you are looking at.
      </p>
      <p>
        A sandbox serves the checkpoint it was <em>started from</em>. Accept a
        later one and the frame says so and asks you to restart it. It does not
        silently become the new project.
      </p>

      <h2>Code</h2>
      <p>
        The generated files, as files. This is the pane to read before accepting
        anything.
      </p>
      <p>
        While a newer checkpoint is staged, the list shows the staged files, but
        the Export, Push and Publish buttons beneath it act on the{' '}
        <strong>last accepted checkpoint</strong>. The pane says so when the two
        differ, because a button that acts on something other than the list
        above it is a trap.
      </p>

      <h2>Console</h2>
      <p>
        Generation lifecycle events: what the run is doing, when it started,
        when it finished, what it cost.
      </p>
      <p>
        <strong>It is not the sandbox’s output.</strong> Sandbox execution is
        real, but its process output is not piped into this pane yet. If your
        project logs something at runtime, that log is in the sandbox, not here.
      </p>

      <h2>Problems</h2>
      <p>
        Validation findings for the staged project: what vibld’s own checks
        found in the files before you accepted them.
      </p>
      <p>
        <strong>It is not the sandbox’s errors.</strong> Install failures, build
        failures and type errors from a sandbox run are not reported here yet. A
        sandbox that fails to start says so in the Preview pane, which is
        currently the only place that knows.
      </p>

      <h2>Publishing, and taking it back down</h2>
      <p>
        <strong>Publish</strong> puts the last accepted checkpoint on the web at
        a name you choose, and anybody with the address can read it. It takes
        two presses: the first names the site, the checkpoint and whether this
        replaces something already live, and the second is the act. It is the
        only control in the builder whose result a stranger can see, which is
        what earns the second press.
      </p>
      <p>
        A preview is not a publish. Running a sandbox, or accepting a
        checkpoint, never makes anything public. Nothing automated can publish
        either: no scheduled run, no webhook, and no text in a pull request or a
        commit message. Only a person asking, in the moment, puts a site on the
        web.
      </p>
      <p>
        <strong>Take it down</strong> is the other half, on the same terms. The
        address stops working immediately and the files are deleted. The name
        stays yours: nobody else can claim it, and publishing again under it is
        what puts the site back. Rolling back to a <em>previous</em> published
        checkpoint is not built yet.
      </p>

      <h2>The header and the footer</h2>
      <p>
        The header carries what you look at while building, and nothing else:
        the brand, the light and dark toggle, the settings menu and your
        account.
      </p>
      <p>
        Everything that is configuration lives behind the gear: your tier and
        this period’s spend against your allowance, the GitHub connection, and
        which provider and model served the last run. Read once, changed rarely,
        and it used to compete with the work for the same row. None of it claims
        anything before there has been a run.
      </p>
      <p>
        The footer carries the two limitations above in one line, for anybody
        who never opens those tabs. It is built from the same source the panes
        are, so it cannot drift away from them. The run count and token figures
        sit beside it, folded away until you ask for them: reference, not news.
      </p>

      <h2>Where this is going</h2>
      <p>
        Both gaps are about wiring an existing thing into a pane, not about
        building the thing. The sandbox already produces the output and the
        errors. Until they arrive here, this page and the panes themselves will
        keep saying so.
      </p>
    </DocPage>
  );
}
