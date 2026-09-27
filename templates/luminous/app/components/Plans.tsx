import { Link } from 'react-router';

import { PLANS } from '../plans';
import { Icon, type IconName } from './Icon';

const PLAN_ICON: Record<string, IconName> = {
  Starter: 'sparkle',
  Team: 'layers',
  Scale: 'rank',
};

/**
 * The plan cards. `detailed` adds each plan's inclusions and a button; the
 * home page shows the short form and links to the pricing page instead.
 */
export function Plans({ detailed = false }: { detailed?: boolean }) {
  return (
    <ul className="plans">
      {PLANS.map((plan) => (
        <li key={plan.name} className={plan.featured ? 'plan warm' : 'plan'}>
          <div className="plan-top">
            <span className={`tile-ic ${plan.tone}`} aria-hidden="true">
              <Icon name={PLAN_ICON[plan.name] ?? 'sparkle'} />
            </span>
            <h3>{plan.name}</h3>
            {plan.featured ? <span className="badge">Most teams</span> : null}
          </div>
          <p className="price">{plan.price}</p>
          <p className="per">{plan.per}</p>
          <p className="summary">{plan.summary}</p>
          {detailed ? (
            <>
              <ul aria-label={`${plan.name} includes`}>
                {plan.includes.map((item) => (
                  <li key={item}>
                    <Icon name="check" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <Link
                to="/contact"
                className={plan.featured ? 'btn btn-warm' : 'btn btn-ghost'}
              >
                {plan.price === '$0'
                  ? 'Start with Starter'
                  : `Ask about ${plan.name}`}
              </Link>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
