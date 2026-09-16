import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, metaFor } from '../site';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'the-builder')!;
const CHECKED = '2026-09-16';

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
        Validation findings for the staged project: what Vibld’s own checks
        found in the files before you accepted them.
      </p>
      <p>
        <strong>It is not the sandbox’s errors.</strong> Install failures, build
        failures and type errors from a sandbox run are not reported here yet. A
        sandbox that fails to start says so in the Preview pane, which is
        currently the only place that knows.
      </p>

      <h2>The header and the footer</h2>
      <p>
        The header reports which provider and model served the last run, your
        tier, and this period’s spend against your allowance. It claims nothing
        before there has been a run.
      </p>
      <p>
        The footer carries the two limitations above in one line, for anybody
        who never opens those tabs. It is built from the same source the panes
        are, so it cannot drift away from them.
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
