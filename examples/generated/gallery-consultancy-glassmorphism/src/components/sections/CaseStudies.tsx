import { motion } from 'motion/react';
import { fadeUp, staggerContainer, glassIn } from '@/lib/motion';

const caseStudies = [
  {
    eyebrow: 'Manufacturing',
    title: 'Family-owned manufacturer prepares for sale',
    challenge:
      'Two owners, one buyer pipeline, and no clear view of what the business was worth.',
    outcome:
      'A staged exit plan and a negotiated sale that closed in 19 weeks.',
    metric: '19',
    metricLabel: 'weeks from mandate to close',
  },
  {
    eyebrow: 'Logistics',
    title: 'Regional carrier untangles dispatch',
    challenge:
      'Twelve dispatchers, four spreadsheets, and service failures that drove customers away.',
    outcome:
      'A simplified scheduling process that cut late deliveries and won back two key accounts.',
    metric: '38%',
    metricLabel: 'fewer late deliveries',
  },
];

export function CaseStudies() {
  return (
    <section id="case-studies" className="bg-background px-5 py-20 sm:px-8 lg:py-28">
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.25 }}
        className="mx-auto max-w-6xl"
      >
        <motion.p variants={fadeUp} className="text-sm font-medium uppercase tracking-[0.2em] text-primary">
          Case studies
        </motion.p>
        <motion.h2
          variants={fadeUp}
          className="mt-4 max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl"
        >
          How we worked with two owners
        </motion.h2>
        <motion.p
          variants={fadeUp}
          className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground"
        >
          Two short examples from our practice. Client names and numbers are illustrative, not results from existing clients.
        </motion.p>

        <div className="mt-12 grid gap-8 md:grid-cols-2">
          {caseStudies.map((study) => (
            <motion.article
              key={study.title}
              variants={glassIn}
              className="flex h-full flex-col gap-8 rounded-3xl border border-white/10 bg-white/10 p-8 shadow-xl shadow-black/20 backdrop-blur-xl"
            >
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.15em] text-primary">
                  {study.eyebrow}
                </p>
                <h3 className="mt-3 font-display text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
                  {study.title}
                </h3>
              </div>
              <div className="space-y-5 text-sm leading-relaxed">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    Challenge
                  </h4>
                  <p className="mt-2 text-base text-foreground/80">{study.challenge}</p>
                </div>
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    Outcome
                  </h4>
                  <p className="mt-2 text-base text-foreground/80">{study.outcome}</p>
                </div>
              </div>
              <div className="mt-auto flex items-end gap-3 pt-4">
                <span className="font-display text-6xl font-semibold leading-none text-foreground">
                  {study.metric}
                </span>
                <span className="pb-1 text-lg font-medium text-primary">
                  {study.metricLabel}
                </span>
              </div>
            </motion.article>
          ))}
        </div>
      </motion.div>
    </section>
  );
}
