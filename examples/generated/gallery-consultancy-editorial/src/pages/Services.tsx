import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import SiteLayout from '@/components/SiteLayout';
import SectionHeading from '@/components/SectionHeading';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fadeUp } from '@/lib/motion';
import { Target, Settings, Users, CheckCircle2 } from 'lucide-react';

const services = [
  {
    icon: Target,
    title: 'Strategy',
    description: 'We help leadership teams clarify direction, set priorities, and make decisions with confidence.',
    details: [
      'Facilitated strategy offsites and planning sessions',
      'Market and competitor analysis',
      'Priority setting and resource allocation',
      'Decision rights and governance design',
    ],
  },
  {
    icon: Settings,
    title: 'Operations',
    description: 'We improve processes and workflows to reduce costs and increase throughput without sacrificing quality.',
    details: [
      'Value stream mapping and process redesign',
      'Standard work and visual management',
      'Capacity planning and scheduling',
      'Daily management and problem solving',
    ],
  },
  {
    icon: Users,
    title: 'Leadership',
    description: 'We develop management teams and build the habits that sustain performance over time.',
    details: [
      'Leadership development programs',
      'One-on-one coaching for managers',
      'Team effectiveness and alignment',
      'Succession planning and promotion processes',
    ],
  },
];

const processSteps = [
  {
    title: 'Listen and assess',
    description: 'We start by understanding your goals, your constraints, and how work actually gets done. We talk to people across the organization.',
  },
  {
    title: 'Design and test',
    description: 'We co-create a practical plan with your team and test it in a pilot area before rolling it out more broadly.',
  },
  {
    title: 'Build capability',
    description: 'We train your people to run the new system themselves, so the improvement sticks after we leave.',
  },
];

export default function Services() {
  return (
    <SiteLayout>
      <section className="mx-auto w-full max-w-4xl px-6 pt-20 pb-12 text-center">
        <SectionHeading kicker="Services" title="How we help you build a stronger organization" align="center" />
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          We work with small and mid-size companies that need practical help making decisions, improving how work gets done, and developing leaders.
        </p>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 pb-20">
        <div className="grid gap-8 md:grid-cols-3">
          {services.map((service) => (
            <motion.div
              key={service.title}
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
            >
              <Card className="flex h-full flex-col p-6">
                <service.icon className="h-8 w-8 text-accent" aria-hidden="true" />
                <h3 className="mt-4 font-display text-2xl font-bold text-primary">{service.title}</h3>
                <p className="mt-3 text-base leading-relaxed text-muted-foreground">{service.description}</p>
                <ul className="mt-6 space-y-2">
                  {service.details.map((detail) => (
                    <li key={detail} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                      <span>{detail}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="bg-muted py-20 sm:py-24">
        <div className="mx-auto w-full max-w-4xl px-6">
          <SectionHeading kicker="Our process" title="A practical way to make change stick" align="center" className="mb-12" />
          <div className="grid gap-8 md:grid-cols-3">
            {processSteps.map((step, index) => (
              <motion.div
                key={step.title}
                variants={fadeUp}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.3 }}
                className="flex flex-col items-start"
              >
                <span className="font-display text-5xl font-bold text-accent">{index + 1}</span>
                <h3 className="mt-2 font-display text-xl font-bold text-primary">{step.title}</h3>
                <p className="mt-2 text-base leading-relaxed text-muted-foreground">{step.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-6 py-20 text-center sm:py-24">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.4 }}
        >
          <h2 className="font-display text-4xl font-bold tracking-tight text-primary sm:text-5xl">Start a conversation</h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
            Tell us about your challenge. We'll respond within two business days.
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link to="/contact">Contact us</Link>
          </Button>
        </motion.div>
      </section>
    </SiteLayout>
  );
}
