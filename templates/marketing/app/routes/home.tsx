import { Link } from 'react-router';
import { Page, Section } from '../components/SiteChrome';
import { metaFor, routeFor } from '../site';

export function meta() {
  return metaFor('/');
}

const PROOF = [
  { figure: '11,400', label: 'parts sourced since 2019' },
  { figure: '1.8 days', label: 'median quote turnaround' },
  { figure: '96%', label: 'of quotes fulfilled at the quoted price' },
];

const STEPS = [
  {
    title: 'Send the part number',
    body: 'A photo of the plate is enough. If the number is unreadable we work from the machine and the failure.',
  },
  {
    title: 'We verify the source',
    body: 'Every supplier is checked for authorised distribution before we quote, so a cheap listing does not become a counterfeit bearing.',
  },
  {
    title: 'You approve, we ship',
    body: 'One price, one delivery date, and a named person who answers if either slips.',
  },
];

export default function Home() {
  const route = routeFor('/');
  return (
    <Page title="Parts, sourced properly." lead={route.description}>
      <p className="mt-8">
        <Link
          to="/contact"
          className="inline-block rounded-md bg-[var(--color-accent)] px-5 py-3 font-medium text-white hover:opacity-90"
        >
          Request a sourcing quote
        </Link>
      </p>

      <Section heading="Where we are useful">
        <dl className="grid gap-6 sm:grid-cols-3">
          {PROOF.map((item) => (
            <div key={item.label}>
              <dt className="text-3xl font-semibold tracking-tight">
                {item.figure}
              </dt>
              <dd className="mt-1 text-[var(--color-ink-muted)]">
                {item.label}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section heading="How it works">
        <ol className="grid gap-6 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <p className="text-sm font-semibold text-[var(--color-accent)]">
                Step {index + 1}
              </p>
              <h3 className="mt-1 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-[var(--color-ink-muted)]">{step.body}</p>
            </li>
          ))}
        </ol>
      </Section>
    </Page>
  );
}
