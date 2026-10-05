import { motion, type Variants } from "motion/react";
import { fadeUp } from "@/lib/motion";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import SectionHeading from "@/components/SectionHeading";
import { Card } from "@/components/ui/card";

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
    description:
      "We run a focused strategy sprint with your leadership team, pressure-test the assumptions behind the plan, and leave you with a written roadmap that names owners and deadlines. The output is a plan that can survive contact with the next quarter.",
    approach: [
      "Leadership workshops",
      "Competitor and market analysis",
      "One-page strategy map",
      "90-day action plan",
    ],
  },
  {
    title: "Operational excellence",
    description:
      "We map your core processes end to end, measure where work queues, and redesign the steps that cause the most friction. The result is fewer handoffs, faster cycle times, and less firefighting.",
    approach: [
      "Process mapping",
      "Bottleneck analysis",
      "Pilot improvements",
      "Control dashboard",
    ],
  },
  {
    title: "Organizational change",
    description:
      "We help you sequence a change so people can absorb it: clear communication, revised incentives, and a new structure that matches the work. We stay through the first 90 days to make sure the change holds.",
    approach: [
      "Stakeholder interviews",
      "Change readiness assessment",
      "Communication plan",
      "Leadership alignment",
    ],
  },
  {
    title: "Performance management",
    description:
      "We replace annual review theater with a lightweight cadence: clear goals at the team level, weekly check-ins on the metrics that matter, and a feedback loop that catches issues early.",
    approach: [
      "OKR or KPI design",
      "Review meeting design",
      "Manager training",
      "Tooling recommendations",
    ],
  },
];

export default function Services() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-[1200px] px-6 py-[clamp(4rem,10vw,8rem)]">
          <SectionHeading
            eyebrow="Services"
            title="What we do"
            description="Four ways we help leadership teams make decisions and follow through."
          />
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            className="grid gap-6 md:grid-cols-2"
          >
            {services.map((service) => (
              <motion.div key={service.title} variants={fadeUp}>
                <Card className="h-full p-8">
                  <h3 className="font-display text-2xl font-semibold text-foreground">
                    {service.title}
                  </h3>
                  <p className="mt-4 text-muted-foreground">{service.description}</p>
                  <div className="mt-6">
                    <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                      Approach
                    </p>
                    <ul className="mt-3 space-y-2">
                      {service.approach.map((item) => (
                        <li key={item} className="text-sm text-muted-foreground">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
