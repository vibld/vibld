import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, metaFor } from '../site';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'running-your-project')!;
const CHECKED = '2026-09-30';

export function meta() {
  return metaFor('/docs/running-your-project');
}

export default function RunningYourProject() {
  return (
    <DocPage guide={GUIDE} updated={CHECKED}>
      <p>
        A sandbox is a real, installed, running copy of your project: a
        dependency install and a dev server, not a rendering of the plan. It is
        how you find out whether the thing actually works.
      </p>

      <h2>Starting one</h2>
      <p>
        <strong>Run live preview</strong> sits in the Preview tab once something
        is built, and runs the project’s current code, including a build that is
        still being checked. It moves through a few states and each one is
        reported rather than hidden behind a spinner:
      </p>
      <ul>
        <li>
          <strong>Queued</strong>, with your position, when every sandbox is
          busy.
        </li>
        <li>
          <strong>Installing dependencies</strong>, which is usually the slow
          part.
        </li>
        <li>
          <strong>Starting the dev server</strong>.
        </li>
        <li>
          <strong>Ready</strong>, at which point the frame is the running app
          and the expiry time is shown below it.
        </li>
        <li>
          <strong>Failed</strong>, with the reason, which is not the same as
          nothing having happened.
        </li>
      </ul>
      <p>
        Sandboxes expire: after ten minutes without use, and thirty minutes
        after starting whatever happens. You have one at a time, so opening
        another project stops it. That is deliberate: a sandbox is for looking
        at your project, not for hosting it. If you want something that stays
        up, that is publishing or your own deployment, covered in{' '}
        <a href="/docs/taking-your-code">Taking your code with you</a>.
      </p>

      <h2>When the project changes</h2>
      <p>
        A running sandbox picks up each new version of the project in place. The
        tab says <strong>Updating preview…</strong> while the changed files go
        in, and the page reloads. When a change touches the project’s
        dependencies, they are installed first and only the dev server is
        restarted. When the sandbox cannot take a change in place (it has
        expired, or an update broke off), the builder restarts it and says why
        beside the preview. <strong>Restart</strong> stays on offer.
      </p>
      <p>
        <strong>Stop</strong> shuts a running sandbox down. It does not touch
        share links, which are covered next.
      </p>

      <h2>Sharing what is running</h2>
      <p>
        <strong>Share</strong> mints a link to the running sandbox.{' '}
        <strong>
          Anyone with that link can view the running app and everything it
          shows, until it is revoked or expires.
        </strong>{' '}
        That warning is in the interface next to the button, not buried in a
        tooltip, because it is the entire risk of the feature.
      </p>
      <p>Two things worth knowing about how shares behave:</p>
      <ul>
        <li>
          Several can be active at once, each with its own expiry, each revoked
          independently. Revoking one does not disturb the others.
        </li>
        <li>
          They are not affected by restarting or stopping the sandbox. A share
          is a grant of access, tracked separately from the thing it grants
          access to.
        </li>
        <li>
          Each lasts 24 hours at most, and never longer than the preview it
          points at.
        </li>
      </ul>
      <p>
        This is not the project’s own share link, the one under{' '}
        <strong>Share</strong> in the top bar, which shows the project’s code
        and lets somebody remix it. See{' '}
        <a href="/docs/the-builder">The builder, pane by pane</a>.
      </p>
      <p>
        If your project shows real data, a share shows real data. Load it with
        something you would be comfortable sending to whoever you are sending
        the link to.
      </p>

      <h2>When a sandbox fails</h2>
      <p>
        The failure reason appears in the Preview tab. It is currently the only
        place it appears: install, build and type errors from a sandbox run are
        not reported under Problems yet, and the sandbox’s process output is not
        piped into the Console. See{' '}
        <a href="/docs/the-builder">The builder, pane by pane</a>.
      </p>
    </DocPage>
  );
}
