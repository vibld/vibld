import { Link } from 'react-router';

import { Plans } from '../components/Plans';
import { Closing, PageHead, SectionHead } from '../components/SiteChrome';
import { PLAN_NOTES } from '../plans';
import { metaFor, routeFor } from '../site';

export function meta() {
  return metaFor('/pricing');
}

export default function Pricing() {
  const route = routeFor('/pricing');
  return (
    <>
      <PageHead
        kicker="Pricing"
        title="Pay for the workspace,"
        emphasis="not the volume"
        lead={route.description}
      />

      <section className="page-body" aria-labelledby="plans-title">
        <div className="wrap">
          <h2 id="plans-title" className="sr-only">
            Plans
          </h2>
          <div className="[&>.plans]:mt-0">
            <Plans detailed />
          </div>
        </div>
      </section>

      <section className="sec pt-0" aria-labelledby="terms-title">
        <div className="wrap">
          <SectionHead
            id="terms-title"
            kicker="On every plan"
            title="The small print,"
            emphasis="printed large"
          />
          <ul className="plain-list two">
            {PLAN_NOTES.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <p className="mt-8">
            <Link to="/faq" className="link">
              Read the questions people ask before buying
            </Link>
          </p>
        </div>
      </section>

      <Closing />
    </>
  );
}
