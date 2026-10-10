import { DocPage } from '../components/SiteChrome';
import { DOC_GUIDES, metaFor } from '../site';

const GUIDE = DOC_GUIDES.find((g) => g.slug === 'api')!;
const CHECKED = '2026-10-09';

export function meta() {
  return metaFor('/docs/api');
}

export default function Api() {
  return (
    <DocPage guide={GUIDE} updated={CHECKED}>
      <p>
        The builder at app.vibld.com is a page that talks to an HTTP API, and
        that API is the same one a script or an agent can call. Everything the
        builder does, from a conversation to a published site, goes through it.
      </p>

      <h2>Where it is described</h2>
      <p>
        The routes, their parameters, bodies and answers are described in an
        OpenAPI 3.1 document:{' '}
        <a href="https://app.vibld.com/api/openapi.json">
          app.vibld.com/api/openapi.json
        </a>
        . It is the contract, and this page is a summary of it. The routes live
        under <code>https://app.vibld.com/api/</code>.
      </p>
      <p>
        vibld.com lists the API in an API catalog at{' '}
        <a href="https://vibld.com/.well-known/api-catalog">
          vibld.com/.well-known/api-catalog
        </a>{' '}
        (RFC 9727), and the home page points at the catalog and the description
        in its <code>Link</code> header, so a tool that knows only the site’s
        name can find both.
      </p>

      <h2>Signing in</h2>
      <p>
        A request is signed in by the session token Clerk issues to somebody
        signed in at app.vibld.com, sent as{' '}
        <code>Authorization: Bearer &lt;token&gt;</code>. The token is issued by{' '}
        <code>https://clerk.vibld.com</code> and checked against its published
        keys. It is short-lived, so a script asks Clerk for a fresh one rather
        than storing it. There are no API keys.
      </p>
      <p>
        Routes that build, preview, publish or spend also need an invitation to
        the beta. Without one they answer <code>403</code> with{' '}
        <code>"reason": "access-refused"</code>, which is a different answer
        from the <code>401</code> a request with no valid token gets. Reading
        what an account already has, such as its projects, runs and balance,
        stays open to it.
      </p>

      <h2>Answers</h2>
      <ul>
        <li>
          Bodies are JSON, except the routes that stream a build’s progress,
          which answer with server-sent events, and{' '}
          <code>GET /api/media/file</code>, which answers with the stored image
          or video bytes.
        </li>
        <li>
          A refusal is <code>{'{ "error": "..." }'}</code>. The sentence is for
          a person and may change. Where a refusal has a stable name to branch
          on, it is in <code>reason</code> or <code>code</code>.
        </li>
        <li>
          Requests are limited per account and per address, and a request over
          the limit is answered <code>429</code>.
        </li>
      </ul>

      <h2>Checking it is up</h2>
      <p>
        <a href="https://app.vibld.com/api/health">app.vibld.com/api/health</a>{' '}
        answers <code>{'{ "status": "ok" }'}</code> without signing in. It only
        says the API is answering, not that every service behind it is.
      </p>

      <h2>What it leaves out</h2>
      <p>
        Administration, the payment and GitHub webhooks, and GitHub’s sign-in
        redirect are routes the builder has but nobody else calls, and the
        description does not include them.
      </p>
    </DocPage>
  );
}
