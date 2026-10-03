import { motion } from 'motion/react';
import { fadeIn } from '@/lib/motion';

const cases = [
  {
    id: 'case-1',
    company: '[Manufacturer]',
    industry: '[Industry]',
    title: 'Reduced order lead time by [X] weeks',
    body: 'We mapped the order-to-cash process and found three handoffs that accounted for most of the delay. The leadership team approved a new routing system and cut lead time from [X] weeks to [Y] weeks.',
  },
  {
    id: 'case-2',
    company: '[Service company]',
    industry: '[Region]',
    title: 'Improved margin on the core service line by [X]%',
    body: 'We worked with the managing director to rebuild the pricing model and remove two low-margin activities. The change shifted mix toward higher-value work without cutting headcount.',
  },
];

export function CaseStudies() {
  return (
    <section id="cases" className="border-t border-border py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <motion.div
          variants={fadeIn}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
        >
          <div className="mb-12 max-w-2xl">
            <p className="mb-4 text-sm uppercase tracking-[0.2em] text-muted-foreground">
              Recent work
            </p>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Case studies
            </h2>
            <p className="mt-4 text-base text-muted-foreground">
              The case studies below use placeholder figures until client approval.
            </p>
          </div>
          <div className="grid gap-10 md:grid-cols-2 md:gap-8">
            {cases.map((c) => (
              <article key={c.id} className="border-b border-border pb-10">
                <div className="mb-4 flex items-center gap-3 text-sm text-muted-foreground">
                  <span className="rounded-sm bg-muted px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Placeholder
                  </span>
                  <span>{c.company}, {c.industry}</span>
                </div>
                <h3 className="text-2xl font-semibold tracking-tight text-foreground">
                  {c.title}
                </h3>
                <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                  {c.body}
                </p>
              </article>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
