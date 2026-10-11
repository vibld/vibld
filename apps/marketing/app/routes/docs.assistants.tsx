import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, metaFor } from '../site';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'assistants')!;
const CHECKED = '2026-10-11';

const MCP_URL = 'https://app.vibld.com/mcp';

/**
 * Claude's own "add a custom connector" dialog, with vibld's name and
 * address already filled in (D220). The person still approves it there
 * and signs in to vibld.
 */
const ADD_TO_CLAUDE_URL = `https://claude.ai/customize/connectors?${new URLSearchParams(
  {
    modal: 'add-custom-connector',
    connectorName: 'vibld',
    connectorUrl: MCP_URL,
  },
)}`;

export function meta() {
  return metaFor('/docs/assistants');
}

export default function Assistants() {
  return (
    <DocPage guide={GUIDE} updated={CHECKED}>
      <p>
        vibld has an MCP server, so the assistant you already use can build with
        it. Ask Claude, ChatGPT, Claude Code or Cursor for a site, and it finds
        a template, starts a build on your vibld account and opens the preview.
        It can also read and change a project’s code itself, check its types,
        take screenshots and go back to a checkpoint.
      </p>

      <h2>Claude</h2>
      <p>
        <a className="button" href={ADD_TO_CLAUDE_URL}>
          Add to Claude
        </a>
      </p>
      <p>
        This opens Claude’s connector settings with vibld already filled in.
        Confirm it there, then sign in to vibld and approve both{' '}
        <strong>build</strong> and <strong>edit</strong>.
      </p>

      <h2>Other assistants</h2>
      <p>
        In ChatGPT, or any other assistant that takes a custom connector or a
        remote MCP server, add one with this address:
      </p>
      <pre>
        <code>{MCP_URL}</code>
      </pre>
      <ul>
        <li>
          Claude Code:{' '}
          <code>claude mcp add --transport http vibld {MCP_URL}</code>
        </li>
        <li>
          Cursor: add a server with <code>"url": "{MCP_URL}"</code> to{' '}
          <code>.cursor/mcp.json</code>.
        </li>
      </ul>
      <p>
        Each asks you to sign in to vibld the first time. There are no API keys
        to copy.
      </p>

      <h2>What it costs</h2>
      <p>
        A build from an assistant is charged to your account exactly as one from
        the builder, and the cost of each run shows in the builder’s history.
        Reading and editing code from an assistant spends no credit; those calls
        count toward a daily number set by your plan.
      </p>

      <h2>What it can see</h2>
      <p>
        Your own projects only, with your plan’s limits. It cannot change your
        plan, billing or account. Remove it from your assistant’s connector
        settings to disconnect it.
      </p>

      <h2>Without signing in</h2>
      <p>
        The server describes itself and lists its tools before anyone signs in,
        so you can see what an assistant would be able to do first. Every tool
        call needs a sign-in. The full description is at{' '}
        <a href="https://vibld.com/.well-known/mcp/server-card.json">
          vibld.com/.well-known/mcp/server-card.json
        </a>
        .
      </p>
    </DocPage>
  );
}
