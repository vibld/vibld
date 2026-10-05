import { motion } from 'motion/react';
import PageHeader from '@/components/PageHeader';
import CaseStudyCard from '@/components/CaseStudyCard';
import { fadeUp, staggerContainer } from '@/lib/motion';

const caseStudies = [
  {
    clientLabel: '[Client name], [Industry]',
    title: "Untangling a manufacturer's order-to-cash process",
    summary: 'A mid-size manufacturer had three teams, two systems, and no single owner for the order handoff. We worked with the operations director to name the owner, remove a redundant approval, and set a weekly review. The new process took time off the invoice cycle and gave the finance team one version of the truth.',
    outcomeLabel: '[Outcome placeholder: time from order to invoice]',
    link: '#/case-studies',
  },
  {
    clientLabel: '[Client name], [Industry]',
    title: "Rescoping a services firm's pricing ladder",
    summary: 'A professional services firm was pricing every project from memory. We built a simple tiered model and retrained the sales team on when to hold the line. The firm stopped discounting by default and started charging for the work it was already doing.',
    outcomeLabel: '[Outcome placeholder: margin by project type]',
    link: '#/case-studies',
  },
];

export default function CaseStudiesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Case studies"
        title="Where the work happened"
        intro="Two engagements, summarized with the details that matter. Client names are placeholders because we do not share who we work with without permission."
      />
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8 lg:pb-28">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
          className="grid gap-8 md:grid-cols-2"
        >
          {caseStudies.map((cs) => (
            <CaseStudyCard key={cs.title} {...cs} />
          ))}
        </motion.div>
      </section>
    </>
  );
}
