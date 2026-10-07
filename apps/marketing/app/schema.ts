/**
 * The JSON-LD that depends on more than `site.ts` knows: the plans, and the
 * questions a page answers.
 *
 * Kept apart from `organizationSchema` because the prices come from
 * `plans.ts`, which reads the builder's source, and site.ts is imported by
 * scripts that must not need that. Everything here is built from the same
 * values the pages print, so the schema cannot state a price or an answer
 * the reader cannot see.
 *
 * There is no `aggregateRating` and no `review`, which Google needs before
 * it will show a SoftwareApplication rich result. This site has neither, and
 * an invented one is worse than no rich result.
 */

import type { Answer } from './answers.ts';
import { dollars, type Plans } from './plans.ts';
import { SITE } from './site.ts';

/** "29.00": schema.org wants a number with no currency symbol. */
function amount(cents: number): string {
  return (cents / 100).toFixed(2);
}

function offer(
  name: string,
  cents: number,
  billing: 'P1M' | 'P1Y' | null,
  description: string,
) {
  const pricing = new URL('/pricing', SITE.url).toString();
  return {
    '@type': 'Offer',
    name,
    description,
    price: amount(cents),
    priceCurrency: 'USD',
    url: pricing,
    ...(billing
      ? {
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: amount(cents),
            priceCurrency: 'USD',
            billingDuration: billing,
          },
        }
      : {}),
  };
}

/** The builder as a product, with one Offer per price the pricing page shows. */
export function softwareApplicationSchema(plans: Plans) {
  const offers = plans.plans.flatMap((plan) => {
    const spend = plan.price
      ? `Includes ${dollars(plan.monthlyCents)} of model spend each month.`
      : `Includes ${dollars(plan.monthlyCents)} of model spend each month once a card is saved, and ${dollars(plans.freeTrialCents)} once without one.`;
    if (!plan.price) return [offer(plan.name, 0, null, spend)];
    return [
      offer(`${plan.name}, monthly`, plan.price.monthly, 'P1M', spend),
      offer(`${plan.name}, annual`, plan.price.annual, 'P1Y', spend),
    ];
  });
  offers.push(
    offer(
      'Top-up',
      plans.topup.priceCents,
      null,
      `Adds ${dollars(plans.topup.creditCents)} of model spend, on any plan.`,
    ),
  );
  return {
    'script:ld+json': {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      '@id': `${SITE.url}/#application`,
      name: SITE.name,
      alternateName: SITE.legalName,
      description: SITE.summary,
      url: SITE.url,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Any (runs in a web browser)',
      browserRequirements: 'Requires a modern web browser with JavaScript.',
      publisher: { '@id': `${SITE.url}/#organization` },
      offers,
    },
  };
}

/** FAQPage schema for questions the page itself shows, word for word. */
export function faqSchema(items: readonly Answer[]) {
  return {
    'script:ld+json': {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: items.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    },
  };
}
