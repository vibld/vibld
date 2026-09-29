/**
 * The questions people put to a search engine or an assistant about vibld,
 * each answered in its first sentence.
 *
 * One list, read by three things: the home page's Questions section, the
 * FAQPage schema beside it, and llms.txt (scripts/postbuild.ts). An answer
 * that exists in three places and is written once cannot say three different
 * things.
 *
 * Every claim here is one the site already makes somewhere else, and the
 * prices are not written here at all: they come from the same `Plans` the
 * pricing page prints, read from the builder's source (plans.ts). There is
 * deliberately no answer that describes another product. What a competitor
 * does is not something this site can keep true, so the comparison answer
 * says what vibld hands you and leaves the reader to compare.
 */

import { dollars, priceLabel, type Plans } from './plans.ts';
import { SITE } from './site.ts';

export interface Answer {
  question: string;
  answer: string;
}

/** "$29 a month or $290 a year", for a paid plan. */
function planPrice(price: { monthly: number; annual: number }): string {
  return `${priceLabel(price.monthly)} a month or ${priceLabel(price.annual)} a year`;
}

function costAnswer(plans: Plans): string {
  const parts = plans.plans.map((plan) =>
    plan.price
      ? `${plan.name} is ${planPrice(plan.price)} and includes ${dollars(plan.monthlyCents)} of model spend each month.`
      : `${plan.name} costs nothing and includes ${dollars(plan.monthlyCents)} of model spend each month.`,
  );
  const signup = plans.signupRequiresCard
    ? `A new account that adds a card also gets ${dollars(plans.signupCents)} of build credit once; the card is saved, not charged.`
    : `A new account also gets ${dollars(plans.signupCents)} of build credit once.`;
  return [
    ...parts,
    `A top-up is ${priceLabel(plans.topup.priceCents)} for ${dollars(plans.topup.creditCents)} of model spend, on any plan.`,
    signup,
    'Prices are in US dollars.',
  ].join(' ');
}

export function answers(plans: Plans): Answer[] {
  return [
    {
      question: `What is ${SITE.name}?`,
      answer: `${SITE.summary} It is in public beta, and anyone can sign up.`,
    },
    {
      question: `How much does ${SITE.name} cost?`,
      answer: costAnswer(plans),
    },
    {
      question: `How is ${SITE.name} different from other AI app builders?`,
      answer:
        'What it hands you is a conventional project: React, TypeScript and Vite, with no vibld package in its dependencies and nothing that checks an account when it runs. You can export it as a .zip or push it to GitHub as a pull request, and the core of the builder is open source under Apache-2.0, so you can read how it works or run your own copy.',
    },
    {
      question: `Can I run ${SITE.name} myself?`,
      answer:
        'Yes. The source is public, and self-hosted, vibld is three Cloudflare Workers on your own Cloudflare account with your own model keys. The self-hosting guide lists what that involves and what differs from the hosted service.',
    },
    {
      question: `Who makes ${SITE.name}?`,
      answer: `${SITE.legalEntity}, in Atlanta, Georgia. The name is a contraction of "vibe" and "build".`,
    },
  ];
}
