import { motion } from 'motion/react';
import { Compass, Gauge, BarChart3, Landmark, Briefcase, Users } from 'lucide-react';
import { fadeUp, staggerContainer, glassIn } from '@/lib/motion';

const services = [
  {
    title: 'Strategic planning',
    description:
      'A working plan for the next three years, built with your team and tied to the numbers.',
    icon: Compass,
  },
  {
    title: 'Operational review',
    description:
      'A focused look at cost, capacity, and workflow to find where effort pays and where it leaks.',
    icon: Gauge,
  },
  {
    title: 'Market analysis',
    description:
      'A practical read on your position, competitors, and the customers worth keeping.',
    icon: BarChart3,
  },
  {
    title: 'Capital allocation',
    description:
      'A disciplined framework for choosing where to invest, hold, or exit.',
    icon: Landmark,
  },
  {
    title: 'M&A advisory',
    description:
      'Search, diligence, and negotiation support for buying or selling a private company.',
    icon: Briefcase,
  },
  {
    title: 'Interim leadership',
    description:
      'A seasoned executive in place for a transition, a turnaround, or a gap in your team.',
    icon: Users,
  },
];

export function Services() {
  return (
    <section id="services" className="bg-background px-5 py-20 sm:px-8 lg:py-28">
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.25 }}
        className="mx-auto max-w-6xl"
      >
        <motion.p variants={fadeUp} className="text-sm font-medium uppercase tracking-[0.2em] text-primary">
          What we do
        </motion.p>
        <motion.h2
          variants={fadeUp}
          className="mt-4 max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl"
        >
          Services for decisions that stick
        </motion.h2>
        <motion.p
          variants={fadeUp}
          className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground"
        >
          We work with leadership teams in private companies to bring a clear-eyed view to strategy, operations, and capital decisions.
        </motion.p>

        <motion.div variants={staggerContainer} className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => {
            const Icon = service.icon;
            return (
              <motion.article
                key={service.title}
                variants={glassIn}
                className="rounded-3xl border border-white/10 bg-white/10 p-6 shadow-xl shadow-black/20 backdrop-blur-xl"
              >
                <div className="flex size-12 items-center justify-center rounded-xl border border-white/10 bg-white/10">
                  <Icon className="size-5 text-primary" aria-hidden />
                </div>
                <h3 className="mt-5 font-display text-xl font-semibold text-foreground">
                  {service.title}
                </h3>
                <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                  {service.description}
                </p>
              </motion.article>
            );
          })}
        </motion.div>
      </motion.div>
    </section>
  );
}
