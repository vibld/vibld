import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import SiteLayout from '@/components/SiteLayout';
import SectionHeading from '@/components/SectionHeading';
import CaseStudyCard from '@/components/CaseStudyCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { fadeUp } from '@/lib/motion';

const serviceItems = [
  { title: 'Strategy', description: 'We help leadership teams clarify direction, set priorities, and make decisions with confidence.' },
  { title: 'Operations', description: 'We improve processes and workflows to reduce costs and increase throughput without sacrificing quality.' },
  { title: 'Leadership', description: 'We develop management teams and build the habits that sustain performance over time.' },
];

const caseStudies = [
  {
    title: 'Reducing production lead time at a mid-size manufacturer',
    details: `Client: [Manufacturing company, 120 employees]\nChallenge: Production lead time was 30% above industry average.\nResult: Reduced lead time by 22% in six months.`,
  },
  {
    title: 'Building a leadership pipeline at a professional services firm',
    details: `Client: [Consulting firm, 45 employees]\nChallenge: High turnover among first-line managers.\nResult: Improved retention by 15% and promoted 12 internal candidates.`,
  },
];

const heroEase = [0.23, 1, 0.32, 1] as const;

export default function Home() {
  return (
    <SiteLayout>
      <section className="mx-auto flex w-full max-w-4xl flex-col items-center px-6 pt-20 pb-24 text-center sm:pt-28 sm:pb-32">
        <motion.h1
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: heroEase }}
          className="font-display text-5xl font-bold tracking-tight text-primary sm:text-6xl md:text-7xl"
        >
          Clear thinking for complex organizations.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: heroEase, delay: 0.1 }}
          className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl"
        >
          A management consultancy that helps small and mid-size companies make confident decisions, improve operations, and build stronger teams.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: heroEase, delay: 0.2 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-4"
        >
          <Button asChild size="lg">
            <Link to="/services">Explore services</Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link to="/case-studies">Read case studies</Link>
          </Button>
        </motion.div>
      </section>

      <section id="services" className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
        <SectionHeading kicker="What we do" title="Three ways to build a stronger organization" align="center" className="mb-12" />
        <div className="grid gap-6 md:grid-cols-3">
          {serviceItems.map((service) => (
            <motion.div
              key={service.title}
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
            >
              <Card className="h-full">
                <CardContent className="flex h-full flex-col p-6">
                  <h3 className="font-display text-2xl font-bold text-primary">{service.title}</h3>
                  <p className="mt-3 text-base leading-relaxed text-muted-foreground">{service.description}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      <section id="case-studies" className="bg-muted py-20 sm:py-24">
        <div className="mx-auto w-full max-w-5xl px-6">
          <SectionHeading kicker="Recent work" title="Outcomes that matter" align="center" className="mb-12" />
          <div className="grid gap-8 md:grid-cols-2">
            {caseStudies.map((cs) => (
              <motion.div
                key={cs.title}
                variants={fadeUp}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.2 }}
              >
                <CaseStudyCard {...cs} />
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
