import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, metaFor } from '../site';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'running-your-project')!;
const CHECKED = '2026-09-16';

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
        <strong>Run in sandbox</strong> sits under the Preview pane and acts on
        the last accepted checkpoint. It moves through a few states and each one
        is reported rather than hidden behind a spinner:
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
          and the expiry time is shown beside the button.
        </li>
        <li>
          <strong>Failed</strong>, with the reason, which is not the same as
          nothing having happened.
        </li>
      </ul>
      <p>
        Sandboxes expire. That is deliberate: a sandbox is for looking at your
        project, not for hosting it. If you want something that stays up, that
        is publishing or your own deployment, covered in{' '}
        <a href="/docs/taking-your-code">Taking your code with you</a>.
      </p>

      <h2>Restarting after a change</h2>
      <p>
        A running sandbox keeps serving the checkpoint it was started from.
        Accepting a newer one does not change what it is serving, and the pane
        says so rather than letting the frame quietly misrepresent the project.
        Use <strong>Restart in sandbox</strong> to run the current one.
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
      </ul>
      <p>
        If your project shows real data, a share shows real data. Load it with
        something you would be comfortable sending to whoever you are sending
        the link to.
      </p>

      <h2>When a sandbox fails</h2>
      <p>
        The failure reason appears in the Preview pane. It is currently the only
        place it appears: install, build and type errors from a sandbox run are
        not reported under Problems yet, and the sandbox’s process output is not
        piped into the Console. See{' '}
        <a href="/docs/the-builder">The builder, pane by pane</a>.
      </p>
    </DocPage>
  );
}
