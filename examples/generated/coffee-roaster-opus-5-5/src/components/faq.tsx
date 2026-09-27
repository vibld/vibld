import { motion } from 'motion/react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { reveal, viewportOnce } from '@/lib/motion';

const questions = [
  {
    id: 'fresh',
    question: 'How fresh is the coffee when it arrives?',
    answer:
      'Subscription bags roast on Tuesday and leave by Wednesday afternoon on USPS Priority Mail, which reaches most US addresses in one to three days. Coffee tastes best from a few days to a few weeks after roasting, so it arrives at the start of that window.',
  },
  {
    id: 'skip',
    question: 'Can I skip a delivery or cancel?',
    answer:
      "Yes. Two days before each roast we email you with links to skip that delivery, change the coffee or cancel. Cancelling takes one click and there's no fee.",
  },
  {
    id: 'grind',
    question: 'Which grind should I choose?',
    answer:
      'Pick the brewer you use most. If you switch between an espresso machine and a French press, choose whole bean and grind at home, because pre-ground coffee suits one method and goes stale faster once the bag is open.',
  },
  {
    id: 'size',
    question: 'How much coffee is in a bag?',
    answer: '340 g, which makes about 20 cups of pour-over at a 1:16 ratio of coffee to water.',
  },
  {
    id: 'shipping',
    question: 'Do you ship outside the US?',
    answer: 'Not yet. We ship to all 50 states from Asheville with USPS Priority Mail.',
  },
];

export function Faq() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="mx-auto grid max-w-page gap-10 px-5 py-24 md:px-10 md:py-32 lg:grid-cols-12 lg:gap-x-10"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={viewportOnce}
        transition={reveal}
        className="lg:col-span-4"
      >
        <div className="lg:sticky lg:top-28">
          <p className="text-label font-semibold uppercase text-primary">FAQ</p>
          <h2 id="faq-heading" className="mt-4 text-headline font-semibold">
            Before you order
          </h2>
          <p className="mt-5 text-body text-muted-foreground">
            Something we missed? Reply to any email we send. Both roasters read the inbox.
          </p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={viewportOnce}
        transition={reveal}
        className="lg:col-span-7 lg:col-start-6"
      >
        <Accordion type="single" collapsible className="border-t border-border">
          {questions.map((item) => (
            <AccordionItem key={item.id} value={item.id}>
              <AccordionTrigger>{item.question}</AccordionTrigger>
              <AccordionContent>{item.answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </motion.div>
    </section>
  );
}
