import { motion } from 'motion/react';
import PageHeader from '@/components/PageHeader';
import ServiceCard from '@/components/ServiceCard';
import { fadeUp, staggerContainer } from '@/lib/motion';

const services = [
  {
    title: 'Operating model design',
    description: 'We map how decisions actually get made, then redesign the handoffs and ownership that slow work down. The result is a structure your team can explain in one breath and act on without a meeting.',
  },
  {
    title: 'Leadership team alignment',
    description: 'We run short, focused sessions that force the choices your leadership team has been avoiding. By the end, every major initiative has an owner and a deadline, and the team has a shared set of priorities they can defend.',
  },
  {
    title: 'Pricing and portfolio strategy',
    description: 'We work through what to charge, what to stop selling, and where to invest next. We build a simple model from your costs, customer data, and margins, then test the changes before you commit. You get a price list that earns its place.',
  },
];

export default function ServicesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Our services"
        title="Three areas, kept deliberately narrow"
        intro="We do not take on work outside these three areas. That focus means we have seen the patterns before and can move quickly when you bring us a problem."
      />
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8 lg:pb-28">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
          className="grid gap-8 md:grid-cols-3"
        >
          {services.map((service) => (
            <ServiceCard key={service.title} title={service.title} description={service.description} />
          ))}
        </motion.div>
      </section>
    </>
  );
}
