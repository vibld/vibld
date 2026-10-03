import { motion } from 'motion/react';
import { fadeIn } from '@/lib/motion';

const services = [
  {
    number: '01',
    title: 'Strategy',
    description: 'We help leadership teams define the problem, weigh options, and commit to a course of action that the whole organisation can follow.',
  },
  {
    number: '02',
    title: 'Operating model',
    description: 'We redesign how work moves through the business: roles, handoffs, and decision rights, so the structure supports the strategy.',
  },
  {
    number: '03',
    title: 'Change management',
    description: 'We plan the sequence of moves that turns a decision into a new way of working, with clear owners and a closed feedback loop.',
  },
];

export function Services() {
  return (
    <section id="services" className="border-t border-border py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <motion.div
          variants={fadeIn}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
        >
          <div className="mb-16 max-w-2xl">
            <p className="mb-4 text-sm uppercase tracking-[0.2em] text-muted-foreground">
              What we do
            </p>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Services
            </h2>
          </div>
          <div className="grid gap-12 md:grid-cols-3 md:gap-8 lg:gap-16">
            {services.map((service) => (
              <div key={service.number}>
                <span className="font-display text-2xl font-semibold text-primary">
                  {service.number}
                </span>
                <h3 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
                  {service.title}
                </h3>
                <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                  {service.description}
                </p>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
