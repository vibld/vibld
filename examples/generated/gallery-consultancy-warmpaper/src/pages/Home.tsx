import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import ServiceCard from '@/components/ServiceCard';
import CaseStudyCard from '@/components/CaseStudyCard';
import { fadeUp, staggerContainer, buttonTap } from '@/lib/motion';

const services = [
  {
    title: 'Operating model design',
    description: 'We map how work actually moves through your company, then redesign the handoffs that slow it down. You get a structure people can explain in one breath.',
  },
  {
    title: 'Leadership team alignment',
    description: 'We run short, focused sessions that turn competing priorities into a single set of decisions. Leadership teams leave with an owner for every key move.',
  },
  {
    title: 'Pricing and portfolio strategy',
    description: 'We help you decide what to charge, what to stop selling, and where to put your next dollar. The result is a product line that earns its place.',
  },
];

const caseStudies = [
  {
    clientLabel: '[Client name], [Industry]',
    title: "Untangling a manufacturer's order-to-cash process",
    summary: 'A mid-size manufacturer had three teams, two systems, and no single owner for the order handoff. We worked with the operations director to name the owner, remove a redundant approval, and set a weekly review.',
    outcomeLabel: '[Outcome placeholder: time from order to invoice]',
    link: '#/case-studies',
  },
  {
    clientLabel: '[Client name], [Industry]',
    title: "Rescoping a services firm's pricing ladder",
    summary: 'A professional services firm was pricing every project from memory. We built a simple tiered model and retrained the sales team on when to hold the line.',
    outcomeLabel: '[Outcome placeholder: margin by project type]',
    link: '#/case-studies',
  },
];

export default function HomePage() {
  return (
    <>
      <section className="border-b border-border">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-32"
        >
          <div className="max-w-3xl">
            <motion.p variants={fadeUp} className="text-sm font-semibold uppercase tracking-widest text-primary">
              Management consultancy
            </motion.p>
            <motion.h1 variants={fadeUp} className="mt-6 font-display text-5xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl text-balance">
              Good decisions made early are cheaper than good decisions made late.
            </motion.h1>
            <motion.p variants={fadeUp} className="mt-8 text-xl leading-relaxed text-muted-foreground max-w-2xl">
              Ashford &amp; Reed is a small management consultancy for leaders who want clearer operating choices, tighter pricing, and teams that pull together.
            </motion.p>
            <motion.div variants={fadeUp} className="mt-10 flex flex-wrap gap-4">
              <motion.div variants={fadeUp} whileTap={buttonTap.whileTap}>
                <Button asChild size="lg">
                  <a href="#/services">See services</a>
                </Button>
              </motion.div>
              <motion.div variants={fadeUp} whileTap={buttonTap.whileTap}>
                <Button asChild variant="outline" size="lg">
                  <a href="#/contact">Start a conversation</a>
                </Button>
              </motion.div>
            </motion.div>
          </div>
        </motion.div>
      </section>

      <section className="py-20 lg:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            className="grid gap-8 md:grid-cols-3"
          >
            <motion.h2 variants={fadeUp} className="md:col-span-3 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl text-balance">
              What we do
            </motion.h2>
            {services.map((service) => (
              <ServiceCard key={service.title} title={service.title} description={service.description} />
            ))}
          </motion.div>
        </div>
      </section>

      <section className="bg-secondary/40 py-20 lg:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            className="grid gap-8 md:grid-cols-2"
          >
            <motion.h2 variants={fadeUp} className="md:col-span-2 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl text-balance">
              Recent work
            </motion.h2>
            {caseStudies.map((cs) => (
              <CaseStudyCard key={cs.title} {...cs} />
            ))}
          </motion.div>
        </div>
      </section>

      <section className="py-20 lg:py-28">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8"
        >
          <motion.h2 variants={fadeUp} className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl text-balance">
            Start with a conversation
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-6 text-lg leading-relaxed text-muted-foreground">
            Tell us what is keeping you up at night. We will ask questions, not pitch.
          </motion.p>
          <motion.div variants={fadeUp} className="mt-10">
            <motion.div variants={fadeUp} whileTap={buttonTap.whileTap}>
              <Button asChild size="lg">
                <a href="#/contact">Get in touch</a>
              </Button>
            </motion.div>
          </motion.div>
        </motion.div>
      </section>
    </>
  );
}
