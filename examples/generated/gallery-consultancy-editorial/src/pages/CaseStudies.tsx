import { motion } from 'motion/react';
import SiteLayout from '@/components/SiteLayout';
import SectionHeading from '@/components/SectionHeading';
import { Card, CardContent } from '@/components/ui/card';
import { clipReveal, fadeUp } from '@/lib/motion';
import { CheckCircle2 } from 'lucide-react';

const caseStudies = [
  {
    title: "Reducing production lead time at a mid-size manufacturer",
    client: "[Manufacturing company, 120 employees]",
    problem: "Production lead time was 30% above industry average. Late deliveries were common, inventory was high, and the leadership team lacked a shared view of where the bottlenecks were.",
    approach: "We mapped the entire production flow, from order entry to shipping. We identified two bottleneck work centers, introduced standard work and visual boards, and coached supervisors on daily problem solving. We also set up a weekly operating review to track lead time and on-time delivery.",
    results: [
      "Lead time reduced by 22% in six months",
      "On-time delivery improved from 78% to 94%",
      "Inventory turns increased by 18%",
    ],
  },
  {
    title: "Building a leadership pipeline at a professional services firm",
    client: "[Consulting firm, 45 employees]",
    problem: "Turnover among first-line managers was high. The firm promoted people based on technical skill, with little preparation for management, and often hired externally for leadership roles.",
    approach: "We designed a leadership development program with monthly cohort sessions and individual coaching. We worked with partners to define clear promotion criteria and created a structured review process. We also coached senior leaders on giving feedback and developing their direct reports.",
    results: [
      "Retention among managers improved by 15%",
      "12 internal candidates were promoted over two years",
      "External hiring for leadership roles dropped by 40%",
    ],
  },
];

export default function CaseStudies() {
  return (
    <SiteLayout>
      <section className="mx-auto w-full max-w-4xl px-6 pt-20 pb-12 text-center">
        <SectionHeading kicker="Case studies" title="Recent client work" align="center" />
        <p className="mt-6 text-muted-foreground">
          Two engagements in detail, with the results we helped achieve. Client names are placeholders.
        </p>
      </section>

      <section className="mx-auto w-full max-w-4xl px-6 pb-20 space-y-16">
        {caseStudies.map((cs) => (
          <motion.div
            key={cs.title}
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
          >
            <Card className="overflow-hidden">
              <motion.div
                variants={clipReveal}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.2 }}
                className="aspect-[21/9] w-full bg-gradient-to-br from-primary to-accent"
              />
              <CardContent className="p-6 sm:p-8">
                <h2 className="font-display text-3xl font-bold text-primary sm:text-4xl">{cs.title}</h2>
                <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-accent">{cs.client}</p>
                <div className="mt-6 space-y-5 text-base leading-relaxed text-muted-foreground">
                  <div>
                    <h3 className="font-display text-xl font-semibold text-foreground">Problem</h3>
                    <p className="mt-1">{cs.problem}</p>
                  </div>
                  <div>
                    <h3 className="font-display text-xl font-semibold text-foreground">Approach</h3>
                    <p className="mt-1">{cs.approach}</p>
                  </div>
                  <div>
                    <h3 className="font-display text-xl font-semibold text-foreground">Results</h3>
                    <ul className="mt-2 space-y-2">
                      {cs.results.map((result) => (
                        <li key={result} className="flex items-start gap-2">
                          <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                          <span>{result}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </section>
    </SiteLayout>
  );
}
