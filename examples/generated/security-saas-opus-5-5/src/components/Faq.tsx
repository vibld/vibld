import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Reveal } from '@/components/Reveal';

const questions = [
  {
    q: 'Is it legal for you to scan our systems?',
    a: 'Before any scan, you prove you control each root domain with a DNS TXT record. Tripline only scans hosts you have confirmed as yours, and the confirmation log can be exported for your auditors.',
  },
  {
    q: 'Can the scans break anything?',
    a: 'The checks are read-only. Tripline reads banners, headers, certificates and DNS records, and never attempts logins, exploits or load tests. Scan traffic comes from a fixed set of IP addresses listed in your dashboard, so your team can recognise it.',
  },
  {
    q: 'Do you need access to our network or cloud accounts?',
    a: 'No. Everything Tripline checks is visible from the public internet. On Business you can add read-only AWS, Azure or Google Cloud connectors to match hosts to the teams that own them, but scanning works without them.',
  },
  {
    q: 'What happens if we go over our host limit?',
    a: 'Scanning continues for 14 days. We email the account owner on day 1 and day 10, and you can upgrade or mark hosts out of scope. After 14 days, the most recently discovered hosts pause until you are back under the limit.',
  },
  {
    q: 'Can we cancel at any time?',
    a: 'Yes, from Settings, without talking to anyone. Monthly plans end with the current billing month. Annual plans are refunded for every unused full month.',
  },
  {
    q: 'What happens when the trial ends?',
    a: 'The trial runs the full Team plan for 14 days without a card. When it ends, scanning pauses until you choose a plan. Your asset map and findings are kept for 30 days, then deleted.',
  },
  {
    q: 'Where is our data stored?',
    a: 'In the EU (Frankfurt) or the US (Virginia). You pick the region at signup, and findings, evidence and backups stay in it.',
  },
];

export function Faq() {
  return (
    <section id="faq" className="border-t border-border bg-card py-24 lg:py-32">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 lg:grid-cols-12">
        <Reveal className="lg:sticky lg:top-24 lg:col-span-4 lg:self-start">
          <p className="font-display text-label font-semibold uppercase text-muted-foreground">FAQ</p>
          <h2 className="mt-4 font-display text-title font-bold text-card-foreground">
            Questions people ask before the trial
          </h2>
          <p className="mt-5 text-muted-foreground">
            Something missing?{' '}
            <a
              href="#contact"
              className="inline-flex min-h-11 cursor-pointer items-center rounded-md font-medium text-card-foreground underline underline-offset-4 outline-none transition-colors duration-150 hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              Ask us directly
            </a>
          </p>
        </Reveal>
        <div className="lg:col-span-7 lg:col-start-6">
          <Accordion type="single" collapsible className="border-t border-border">
            {questions.map((item, index) => (
              <AccordionItem key={item.q} value={`item-${index}`}>
                <AccordionTrigger>{item.q}</AccordionTrigger>
                <AccordionContent>{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
