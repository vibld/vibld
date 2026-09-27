import { Page, Section } from '../components/SiteChrome';
import { metaFor, routeFor } from '../site';

export function meta() {
  return metaFor('/what-we-do');
}

const SERVICES = [
  {
    title: 'Obsolete and discontinued parts',
    body: 'When a manufacturer has stopped supplying a component, we trace remaining authorised stock, and tell you plainly when there is none left rather than substituting quietly.',
  },
  {
    title: 'Verification before purchase',
    body: 'Supplier authorisation, lot traceability and, for critical components, physical inspection against the manufacturer specification.',
  },
  {
    title: 'Consolidated logistics',
    body: 'Parts from several suppliers arrive as one shipment on one date, with one set of paperwork for your goods-in team.',
  },
  {
    title: 'Standing coverage',
    body: 'For lines that cannot stop, we hold an agreed set of spares and replace them as they are drawn down.',
  },
];

export default function WhatWeDo() {
  const route = routeFor('/what-we-do');
  return (
    <Page title="What we do" lead={route.description}>
      <Section heading="Services">
        <dl className="grid gap-8 sm:grid-cols-2">
          {SERVICES.map((service) => (
            <div key={service.title}>
              <dt className="text-lg font-semibold">{service.title}</dt>
              <dd className="mt-2 text-[var(--color-ink-muted)]">
                {service.body}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section heading="What we do not do">
        <p className="max-w-2xl text-[var(--color-ink-muted)]">
          We do not machine bespoke parts, and we do not broker stock we cannot
          trace to an authorised distributor. If a request falls outside that,
          we say so on the same day rather than holding the enquiry open.
        </p>
      </Section>
    </Page>
  );
}
