import { Link } from "react-router-dom";
import { motion, type Variants } from "motion/react";
import {
  fadeUp,
  fadeIn,
  transition,
} from "@/lib/motion";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SectionHeading from "@/components/SectionHeading";
import ServiceCard from "@/components/ServiceCard";
import CaseStudyCard from "@/components/CaseStudyCard";
import { Button } from "@/components/ui/button";

const containerVariants: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0,
    },
  },
};

const services = [
  {
    title: "Strategic planning",
    description: "A clear, measurable plan that leadership actually uses.",
  },
  {
    title: "Operational excellence",
    description: "Find and remove the bottlenecks that slow delivery.",
  },
  {
    title: "Organizational change",
    description: "Make change stick by aligning structure, incentives, and communication.",
  },
  {
    title: "Performance management",
    description: "Set goals people own and review them without drama.",
  },
];

const caseStudies = [
  {
    client: "Manufacturing client",
    title: "Three-year strategic plan",
    outcome:
      "We facilitated leadership workshops and built a roadmap the whole executive team signed off on.",
  },
  {
    client: "Logistics client",
    title: "Weekly performance dashboard",
    outcome:
      "We replaced a monthly reporting pack with a live view of key metrics, so issues surfaced in days, not weeks.",
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className="mx-auto max-w-[1200px] px-6 py-[clamp(4rem,10vw,8rem)]">
          <div className="max-w-[700px]">
            <motion.h1
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="font-display text-[clamp(3rem,8vw,6rem)] font-bold leading-[0.95] tracking-[-0.03em] text-foreground"
            >
              Clarity for complex decisions.
            </motion.h1>
            <motion.p
              variants={fadeIn}
              initial="hidden"
              animate="show"
              transition={{ delay: 0.05, ...transition }}
              className="mt-6 max-w-xl text-lg text-muted-foreground"
            >
              Crux Consulting works with leadership teams to map strategy, streamline
              operations, and make accountability stick.
            </motion.p>
            <motion.p
              variants={fadeIn}
              initial="hidden"
              animate="show"
              transition={{ delay: 0.1, ...transition }}
              className="mt-3 text-lg text-foreground"
            >
              Small firm, senior attention. No junior handoffs.
            </motion.p>
            <motion.div
              variants={fadeIn}
              initial="hidden"
              animate="show"
              transition={{ delay: 0.15, ...transition }}
              className="mt-8 flex flex-wrap gap-4"
            >
              <Button asChild size="lg">
                <Link to="/contact">Start a conversation</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/services">See our services</Link>
              </Button>
            </motion.div>
          </div>
        </section>

        {/* Services preview */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-[1200px] px-6 py-[clamp(4rem,10vw,8rem)]">
            <SectionHeading title="What we do" />
            <motion.div
              variants={containerVariants}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              className="grid gap-6 md:grid-cols-2 lg:grid-cols-4"
            >
              {services.map((service) => (
                <motion.div key={service.title} variants={fadeUp}>
                  <ServiceCard
                    title={service.title}
                    description={service.description}
                  />
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Case studies preview */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-[1200px] px-6 py-[clamp(4rem,10vw,8rem)]">
            <SectionHeading
              title="Recent work"
              description="Two short case studies, anonymized to protect client confidentiality."
            />
            <motion.div
              variants={containerVariants}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              className="grid gap-6 md:grid-cols-2"
            >
              {caseStudies.map((item) => (
                <motion.div key={item.title} variants={fadeUp}>
                  <CaseStudyCard
                    client={item.client}
                    title={item.title}
                    outcome={item.outcome}
                  />
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Differentiator */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-[800px] px-6 py-[clamp(4rem,10vw,8rem)] text-center">
            <SectionHeading
              align="center"
              title="We are a small consultancy. That is the point."
              description="You work directly with the people who do the work. No layers, no handoffs, no recycled frameworks."
            />
          </div>
        </section>

        {/* Contact CTA */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-[600px] px-6 py-[clamp(4rem,10vw,8rem)] text-center">
            <SectionHeading
              align="center"
              title="Talk to us"
              description="Tell us what you are trying to solve. We will reply within one business day."
            />
            <motion.div
              variants={fadeIn}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
            >
              <Button asChild size="lg">
                <Link to="/contact">Contact us</Link>
              </Button>
            </motion.div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
