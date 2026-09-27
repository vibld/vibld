import { Page } from '../components/SiteChrome';
import { metaFor, routeFor } from '../site';

export function meta() {
  return metaFor('/faq');
}

const QUESTIONS = [
  {
    q: 'How long does a quote take?',
    a: 'Most quotes go out within one business day. A discontinued part with no obvious source can take three or four, and we tell you that on day one rather than letting the enquiry go quiet.',
  },
  {
    q: 'What happens if the part is genuinely unobtainable?',
    a: 'We say so, and we say what we checked. Where a functional equivalent exists we describe how it differs from the original, so the substitution is your decision rather than ours.',
  },
  {
    q: 'How do you avoid counterfeit components?',
    a: 'We buy only from distributors we can confirm are authorised for that manufacturer. For critical components we inspect against the manufacturer specification before shipping, and the lot number travels with the paperwork.',
  },
  {
    q: 'Can we return a part we no longer need?',
    a: 'Unopened stock in original packaging can be returned within 30 days. Parts ordered specifically for you cannot always be returned to the supplier, and we tell you which category a line falls into before you approve the order.',
  },
  {
    q: 'Do you ship outside the UK?',
    a: 'Yes, across the EU and to North America. Duties and import paperwork are quoted separately so the landed cost is visible before you commit.',
  },
];

/**
 * Plain headings and paragraphs rather than a JavaScript accordion. The
 * content is the point, it is short enough to read, and this way it is
 * legible to a crawler and to someone who has disabled scripts.
 */
export default function Faq() {
  const route = routeFor('/faq');
  return (
    <Page title="Frequently asked questions" lead={route.description}>
      <dl className="mt-12 space-y-8">
        {QUESTIONS.map((item) => (
          <div key={item.q} className="max-w-2xl">
            <dt className="text-lg font-semibold">{item.q}</dt>
            <dd className="mt-2 text-[var(--color-ink-muted)]">{item.a}</dd>
          </div>
        ))}
      </dl>
    </Page>
  );
}
