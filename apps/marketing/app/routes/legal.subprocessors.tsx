import { LegalPage } from '../components/SiteChrome';
import { LEGAL_DOCS, SITE, metaFor } from '../site';

const DOC = LEGAL_DOCS.find((d) => d.slug === 'subprocessors')!;
const UPDATED = '2026-09-10';

interface Subprocessor {
  name: string;
  purpose: string;
  location: string;
}

/** Actually in use today, processing real waitlist data. */
const CURRENT: Subprocessor[] = [
  {
    name: 'Cloudflare, Inc.',
    purpose: 'Hosting, content delivery, and this site’s domain',
    location: 'United States',
  },
  {
    name: 'Resend',
    purpose: 'Storing waitlist email addresses and sending notification email',
    location: 'United States',
  },
];

/**
 * Named in the accepted architecture but not yet processing any user data --
 * there is no product for them to serve. Listed so this page does not need a
 * rewrite the day each one goes live, and so no one is surprised later.
 */
const PLANNED: Subprocessor[] = [
  {
    name: 'Anthropic, PBC / DeepSeek',
    purpose: 'AI model providers for generating application code',
    location: 'United States / see provider',
  },
  {
    name: 'Clerk',
    purpose: 'Account authentication',
    location: 'United States',
  },
  {
    name: 'Stripe, Inc.',
    purpose: 'Payment processing for paid plans',
    location: 'United States',
  },
];

export function meta() {
  return metaFor('/legal/subprocessors');
}

export default function Subprocessors() {
  return (
    <LegalPage title={DOC.label} updated={UPDATED}>
      <p>
        A subprocessor is a third party we use to help operate the Service. This
        page lists them honestly in two groups: who is actually processing data
        today, and who is named in our accepted architecture for when the
        product launches but is not yet in use.
      </p>

      <h2>Currently in use</h2>
      <table>
        <thead>
          <tr>
            <th>Subprocessor</th>
            <th>Purpose</th>
            <th>Location</th>
          </tr>
        </thead>
        <tbody>
          {CURRENT.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              <td>{row.purpose}</td>
              <td>{row.location}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Planned for product launch</h2>
      <p>Not yet processing any data. Listed here in advance:</p>
      <table>
        <thead>
          <tr>
            <th>Subprocessor</th>
            <th>Purpose</th>
            <th>Location</th>
          </tr>
        </thead>
        <tbody>
          {PLANNED.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              <td>{row.purpose}</td>
              <td>{row.location}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Changes</h2>
      <p>
        We will update this page when a subprocessor moves from &ldquo;
        planned&rdquo; to &ldquo;current,&rdquo; or when we add or remove one.
        Questions can be sent to{' '}
        <a href={`mailto:${SITE.emails.privacy}`}>{SITE.emails.privacy}</a>.
      </p>
    </LegalPage>
  );
}
