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

const caseStudies = [
  {
    client: "Manufacturing client",
    title: "Three-year strategic plan",
    situation:
      "A regional manufacturer of industrial components was facing flat revenue and disagreement among the leadership team about where to focus next.",
    work:
      "We ran a series of half-day workshops over six weeks, interviewed the executive team individually, and built a single-page strategy map with owners for each initiative.",
    outcome:
      "The executive team signed off on a three-year roadmap with 11 named initiatives, a clear capital allocation plan, and a quarterly review cadence they still use today.",
  },
  {
    client: "Logistics client",
    title: "Weekly performance dashboard",
    situation:
      "A logistics provider relied on a monthly reporting pack that was often two weeks out of date by the time anyone saw it. Operational problems went unnoticed for weeks.",
    work:
      "We defined the five metrics that mattered most to on-time delivery and cost per shipment, then built a lightweight weekly review with the operations team.",
    outcome:
      "Issues now surface in days rather than weeks. The operations team holds a 30-minute Monday huddle and has a clear escalation path when a metric moves out of range.",
  },
];

export default function CaseStudies() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-[1200px] px-6 py-[clamp(4rem,10vw,8rem)]">
          <SectionHeading
            eyebrow="Case studies"
            title="Recent work"
            description="Two anonymized engagements. Client names, industries, and details have been altered to protect confidentiality. No real metrics are shared."
          />
          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            className="grid gap-8 md:grid-cols-2"
          >
            {caseStudies.map((item) => (
              <motion.div key={item.title} variants={fadeUp}>
                <Card className="h-full p-8">
                  <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                    {item.client}
                  </p>
                  <h3 className="mt-2 font-display text-2xl font-semibold text-foreground">
                    {item.title}
                  </h3>
                  <div className="mt-6 space-y-4">
                    <div>
                      <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                        Situation
                      </p>
                      <p className="mt-2 text-muted-foreground">{item.situation}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                        What we did
                      </p>
                      <p className="mt-2 text-muted-foreground">{item.work}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                        Outcome
                      </p>
                      <p className="mt-2 text-muted-foreground">{item.outcome}</p>
                    </div>
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
