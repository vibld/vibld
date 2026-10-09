import { LegalPage } from '../components/SiteChrome';
import { LEGAL_DOCS, SITE, metaFor } from '../site';

const DOC = LEGAL_DOCS.find((d) => d.slug === 'subprocessors')!;
const UPDATED = SITE.legalEffectiveDate;

interface Subprocessor {
  name: string;
  purpose: string;
  location: string;
}

/**
 * Every service the site and the builder send personal data or project
 * content to. Each purpose says what the service receives, from the code
 * that sends it: packages/ai for the model providers, apps/web/worker for
 * Clerk and Stripe, apps/marketing/worker for Resend.
 *
 * The model providers are named by the entity their published API terms say
 * a customer contracts with (checked 2026-09-28): OpenAI's Services Agreement
 * (openai.com/policies/services-agreement) names OpenAI OpCo, LLC for
 * customers outside the EEA and Switzerland, and DeepSeek's Open Platform
 * Terms of Service name Hangzhou DeepSeek Artificial Intelligence Co., Ltd.
 * Cloudflare's location is where the `vibld-control-plane` D1 database and
 * R2 bucket are: the ENAM location, default jurisdiction.
 *
 * The stock photo services (D176, packages/ai/src/stock-photos.ts) are named
 * by their terms (checked 2026-10-09): Unsplash's API Terms are an agreement
 * with Unsplash Inc. (Montréal), and Pexels' Terms of Service name it a
 * Canva Germany GmbH brand.
 */
const CURRENT: Subprocessor[] = [
  {
    name: 'Cloudflare, Inc.',
    purpose:
      'Hosts this site, the builder, previews and published sites. Stores project files, uploads, published sites, account, billing and referral records (D1, R2, Durable Objects); runs generations (Workflows) and previews (Containers); keeps our logs and this site’s page-view counts (Analytics Engine); runs Turnstile',
    location: 'United States (Eastern North America)',
  },
  {
    name: 'Clerk',
    purpose:
      'Accounts: your email address, its verification, and how you sign in',
    location: 'United States',
  },
  {
    name: 'Stripe, Inc.',
    purpose:
      'Payments, subscriptions, and the card you save for the Free plan’s monthly allowance. Receives your card and billing details directly',
    location: 'United States',
  },
  {
    name: 'Anthropic, PBC',
    purpose:
      'Runs on Claude models: your prompt, standing instructions, reference-page text, chosen mockup, media names and alt text, and your project’s files',
    location: 'United States',
  },
  {
    name: 'OpenAI OpCo, LLC',
    purpose:
      'Runs on GPT models: the same as Anthropic, sent with response storage turned off',
    location: 'United States',
  },
  {
    name: 'Hangzhou DeepSeek Artificial Intelligence Co., Ltd.',
    purpose: 'Runs on DeepSeek models: the same as Anthropic',
    location: 'People’s Republic of China',
  },
  {
    name: 'Unsplash Inc.',
    purpose:
      'Stock photos for a first build with no uploaded images: up to three words from your prompt, as a search, and which of its photos your site uses. Your site’s visitors load those photos from Unsplash',
    location: 'Canada',
  },
  {
    name: 'Canva Germany GmbH (Pexels)',
    purpose:
      'Stock photos when Unsplash has none: the same search words. Your site’s visitors load those photos from Pexels',
    location: 'Germany',
  },
  {
    name: 'Resend',
    purpose:
      'Waitlist and account holders’ email addresses, to send the waitlist the email that announces the open beta and occasional product news, and to send account holders occasional product news',
    location: 'United States',
  },
  {
    name: 'Google LLC',
    purpose:
      'Google Analytics 4, which measures page views on vibld.com only, never in the builder, and only if you agree, and sets cookies to do it',
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
        A subprocessor is a third party we use to help operate the Service and
        that receives personal data or your content to do it. Each row says what
        the service receives. Only one model provider receives a given run: the
        provider of the model you choose.
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

      <h2>Services you choose to connect</h2>
      <p>
        <strong>GitHub</strong> receives your project&apos;s files, and the
        uploaded media they reference, only when you connect a repository and
        push to it, and only for that repository. GitHub is not processing data
        for us; it is your own account, under GitHub&apos;s terms.
      </p>
      <p>
        When you give a reference page, vibld fetches it from Cloudflare, so the
        site you name sees a request from vibld. Previews install packages from
        the public npm registry, which sees the names of the packages your
        project uses and nothing about you.
      </p>

      <h2>Changes</h2>
      <p>
        We will update this page when we add or remove a subprocessor, or change
        what one receives. Questions can be sent to{' '}
        <a href={`mailto:${SITE.emails.privacy}`}>{SITE.emails.privacy}</a>.
      </p>
    </LegalPage>
  );
}
