import type { LucideIcon } from 'lucide-react';
import { Accessibility, Bus, Car, ExternalLink, Info, MapPin, Phone, TrainFront } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Blob } from '@/components/Blob';
import { Lift } from '@/components/Lift';
import { Reveal } from '@/components/Reveal';
import { PRACTICE } from '@/lib/hours';
import { EASE_OUT } from '@/lib/motion';

const WAYS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Bus,
    title: 'By bus',
    body: 'Routes 12 and 40 stop outside the library on Fernbank Road, a two minute walk from our door.',
  },
  {
    icon: Car,
    title: 'By car',
    body: 'Four free spaces behind the building, including one wide bay. Alder Lane has free street parking after 10:00.',
  },
  {
    icon: TrainFront,
    title: 'By train',
    body: 'Millbrook station is a 12 minute walk along the canal path. Turn right at the footbridge.',
  },
  {
    icon: Accessibility,
    title: 'Access',
    body: 'Step-free entrance and a ground floor surgery. Mention it when you book and we will put you in that room.',
  },
];

function MapIllustration() {
  return (
    <svg
      viewBox="0 0 500 400"
      className="absolute inset-0 size-full"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <path
        d="M-20 300 C 80 260, 160 340, 260 300 S 420 220, 520 250"
        fill="none"
        stroke="var(--sage)"
        strokeWidth="26"
        strokeLinecap="round"
      />
      <path
        d="M-10 140 C 120 150, 260 110, 520 130"
        fill="none"
        stroke="var(--card)"
        strokeWidth="12"
        strokeLinecap="round"
      />
      <path
        d="M40 -10 C 120 100, 200 150, 250 200 S 380 330, 460 420"
        fill="none"
        stroke="var(--card)"
        strokeWidth="18"
        strokeLinecap="round"
      />
      <rect x="150" y="185" width="46" height="34" rx="10" fill="var(--clay)" opacity="0.45" />
      <rect x="380" y="270" width="70" height="40" rx="12" fill="var(--bark)" opacity="0.55" />
      <g fill="var(--muted-foreground)" fontFamily="Figtree, sans-serif" fontSize="17" fontWeight="500">
        <text x="70" y="128">Alder Lane</text>
        <text x="312" y="244" transform="rotate(42 312 244)">Fernbank Road</text>
        <text x="170" y="352">Canal path</text>
        <text x="140" y="240">Library</text>
        <text x="386" y="262">Station</text>
      </g>
    </svg>
  );
}

export function Directions() {
  return (
    <section id="directions" aria-labelledby="directions-heading" className="overflow-x-clip py-20 lg:py-32">
      <div className="mx-auto grid max-w-300 items-center gap-14 px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:px-12">
        <motion.div
          className="relative w-full lg:-ml-16"
          initial={{ opacity: 0, clipPath: 'inset(0% 0% 100% 0%)' }}
          whileInView={{ opacity: 1, clipPath: 'inset(0% 0% 0% 0%)' }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
        >
          <div className="grain relative aspect-[5/4] overflow-hidden rounded-blob bg-secondary">
            <MapIllustration />
            <div className="absolute top-[53%] left-[54%] -translate-x-1/2 -translate-y-full">
              <div className="relative">
                <Blob className="-inset-3 bg-primary/25" duration={3.2} />
                <span className="relative grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-soft">
                  <MapPin aria-hidden="true" className="size-6" />
                </span>
              </div>
            </div>
            <p
              aria-hidden="true"
              className="absolute top-[55%] left-[54%] -translate-x-1/2 rounded-full bg-card px-3 py-1 text-small font-medium whitespace-nowrap text-foreground shadow-soft"
            >
              Fernbank Dental
            </p>
          </div>
        </motion.div>

        <Reveal>
          <p className="text-small font-medium text-clay">Directions</p>
          <h2 id="directions-heading" className="mt-3 font-display text-heading font-medium">
            Finding us
          </h2>
          <address className="mt-6 text-lede not-italic">
            <span className="block font-medium">{PRACTICE.name}</span>
            <span className="block">{PRACTICE.street}</span>
            <span className="block">{PRACTICE.town}</span>
          </address>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Lift className="w-full sm:w-auto">
              <Button asChild className="w-full">
                <a href={PRACTICE.mapHref} target="_blank" rel="noreferrer">
                  Open in OpenStreetMap
                  <ExternalLink aria-hidden="true" className="size-4" />
                </a>
              </Button>
            </Lift>
            <Lift className="w-full sm:w-auto">
              <Button asChild variant="outline" className="w-full">
                <a href={PRACTICE.phoneHref}>
                  <Phone aria-hidden="true" className="size-4" />
                  Call {PRACTICE.phone}
                </a>
              </Button>
            </Lift>
          </div>

          <ul className="mt-12 grid gap-6 sm:grid-cols-2">
            {WAYS.map((way) => {
              const Icon = way.icon;
              return (
                <li key={way.title} className="flex gap-4">
                  <span className="grid size-12 shrink-0 place-items-center rounded-blob bg-accent text-accent-foreground">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-medium">{way.title}</h3>
                    <p className="mt-1 text-muted-foreground">{way.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="mt-10 flex gap-3 rounded-organic-alt bg-muted p-5 text-small text-muted-foreground">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            Sample address, phone number and travel details. Replace them with the practice's own before publishing.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
