import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, metaFor } from '../site';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'taking-your-code')!;
const CHECKED = '2026-09-30';

export function meta() {
  return metaFor('/docs/taking-your-code');
}

export default function TakingYourCode() {
  return (
    <DocPage guide={GUIDE} updated={CHECKED}>
      <p>
        The output is a conventional project. There is no proprietary runtime to
        keep it working and nothing that stops building the day you stop paying.
        Three ways out, all under <strong>Ship</strong> in the top bar, and they
        do different things. Each acts on the last finished checkpoint: while a
        new build is still being checked, that is the one before it.
      </p>

      <h2>Export</h2>
      <p>
        Downloads the checkpoint as an archive: the files, as they are, ready to
        open in an editor and run with the package manager the project declares.
        Nothing is rewritten on the way out and nothing phones home.
      </p>
      <p>
        It needs no account, including yours, and works the same on the hosted
        service and on your own copy.
      </p>

      <h2>Push to GitHub</h2>
      <p>
        Each project pushes to a repository of its own. The first push from a
        project offers two choices, both through a GitHub sign-in:
      </p>
      <ul>
        <li>
          <strong>Create a new repository</strong>, named from the project (you
          can change the name) and private unless you untick it, on your own
          GitHub account.
        </li>
        <li>
          <strong>Use an existing repository</strong>, from the ones the vibld
          GitHub App can reach and you can push to.
        </li>
      </ul>
      <p>
        A push writes the checkpoint as a branch named{' '}
        <code>vibld/&lt;revision&gt;</code>, one commit carrying the generated
        files, and a pull request against the repository’s default branch.
      </p>
      <p>
        <strong>Disconnect</strong> on a project stops that project pushing
        there and touches no other project, even one using the same repository.{' '}
        <strong>Disconnect GitHub</strong> in the settings menu ends every
        project’s connection and the sign-in. Duplicating or remixing a project
        does not copy its repository.
      </p>
      <p>The access it uses:</p>
      <ul>
        <li>
          It is scoped to the{' '}
          <strong>single repository the project uses</strong>. The token minted
          for a push names that repository explicitly, so it cannot reach the
          rest of an installation even if the installation covers more.
        </li>
        <li>
          The grant <strong>expires after 90 days</strong>. A revoked or expired
          grant blocks new pushes, and its record is kept.
        </li>
      </ul>
      <p>
        A push is safe to retry: retrying a checkpoint produces the identical
        commit rather than a second one.
      </p>

      <h2>Publish</h2>
      <p>
        Builds the checkpoint and serves it at the project’s own address,{' '}
        <code>&lt;slug&gt;.vibld-preview.dev</code>. Unlike a sandbox, it is the
        built output, not a dev server on a timer. Each project has its own
        site, and deleting the project takes its site down. Images and fonts the
        build itself emits are not published yet; files from your media library
        are.
      </p>
      <p>
        Publishing is still vibld hosting your project. For your own domain and
        account, export it or push it and deploy from there.
      </p>

      <h2>What you own</h2>
      <p>
        What vibld generates for you is yours. The terms covering the vibld core
        itself, the starter templates, and what you build with it are set out on
        the <a href="/legal/licenses">Open-Source Notices</a> page, which is the
        authoritative statement rather than this summary.
      </p>
    </DocPage>
  );
}
