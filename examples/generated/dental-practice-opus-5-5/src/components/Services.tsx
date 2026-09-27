import type { LucideIcon } from 'lucide-react';
import { Baby, Clock, Crown, Layers, Siren, Sparkles, Stethoscope, Syringe } from 'lucide-react';
import { motion } from 'motion/react';
import { Reveal } from '@/components/Reveal';
import { EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';

type Tone = 'accent' | 'card' | 'secondary';

type Service = {
  icon: LucideIcon;
  title: string;
  body: string;
  meta: string;
  tone: Tone;
  span?: string;
};

const SERVICES: Service[] = [
  {
    icon: Stethoscope,
    title: 'Check-ups and hygiene',
    body: 'An examination, a scale and polish, and a plain explanation of what we found. We take X-rays when there is a reason to, usually every one to two years.',
    meta: '30 minutes',
    tone: 'accent',
    span: 'md:col-span-2',
  },
  {
    icon: Layers,
    title: 'Fillings',
    body: 'White composite fillings, matched to the shade of your own teeth.',
    meta: '30 to 60 minutes',
    tone: 'card',
  },
  {
    icon: Syringe,
    title: 'Root canal treatment',
    body: 'Done over one or two visits with local anaesthetic, with a review a week later.',
    meta: '60 to 90 minutes',
    tone: 'card',
  },
  {
    icon: Crown,
    title: 'Crowns and bridges',
    body: 'Made from a digital scan of your teeth, so there are no putty impressions.',
    meta: 'Two visits',
    tone: 'card',
  },
  {
    icon: Baby,
    title: "Children's dentistry",
    body: 'Short first visits for under fives: sit in the chair, count some teeth, go home with a sticker.',
    meta: '20 minutes',
    tone: 'card',
  },
  {
    icon: Siren,
    title: 'Emergency appointments',
    body: 'We keep slots free every weekday morning for pain, swelling and broken teeth. Phone from 08:00 and we will fit you in that day.',
    meta: 'Same day, Monday to Friday',
    tone: 'secondary',
    span: 'md:col-span-2',
  },
  {
    icon: Sparkles,
    title: 'Whitening',
    body: 'Custom trays for whitening at home, once a check-up shows your teeth and gums are healthy.',
    meta: 'Two visits',
    tone: 'card',
    span: 'md:col-span-2 lg:col-span-1',
  },
];

const TONES: Record<Tone, { card: string; icon: string; body: string }> = {
  accent: { card: 'bg-accent text-accent-foreground', icon: 'bg-card', body: 'text-accent-foreground' },
  card: { card: 'bg-card text-card-foreground', icon: 'bg-secondary', body: 'text-muted-foreground' },
  secondary: { card: 'bg-secondary text-secondary-foreground', icon: 'bg-card', body: 'text-muted-foreground' },
};

export function Services() {
  return (
    <section id="services" aria-labelledby="services-heading" className="py-20 lg:py-32">
      <div className="mx-auto max-w-300 px-6 lg:px-12">
        <Reveal className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-end lg:gap-16">
          <div>
            <p className="text-small font-medium text-clay">Services</p>
            <h2 id="services-heading" className="mt-3 font-display text-heading font-medium">
              What we do
            </h2>
          </div>
          <p className="max-w-xl text-lede text-muted-foreground lg:justify-self-end">
            General care for the whole family, plus the treatments most people need at some point. If you are not
            sure which appointment to book, ask for a check-up and we will plan the rest from there.
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-2 lg:mt-20 lg:grid-cols-3">
          {SERVICES.map((service, index) => {
            const Icon = service.icon;
            const tone = TONES[service.tone];
            return (
              <motion.article
                key={service.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.5, ease: EASE_OUT, delay: (index % 3) * 0.06 }}
                className={cn(
                  'flex min-h-64 flex-col gap-5 border border-border p-7 shadow-soft sm:p-9',
                  index % 2 === 0 ? 'rounded-organic' : 'rounded-organic-alt',
                  tone.card,
                  service.span,
                )}
              >
                <span className={cn('grid size-14 place-items-center rounded-blob', tone.icon)}>
                  <Icon aria-hidden="true" className="size-6 text-primary" />
                </span>
                <h3 className="font-display text-title font-medium">{service.title}</h3>
                <p className={cn('max-w-prose', tone.body)}>{service.body}</p>
                <p className="mt-auto flex items-center gap-2 text-small font-medium">
                  <Clock aria-hidden="true" className="size-4" />
                  {service.meta}
                </p>
              </motion.article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
