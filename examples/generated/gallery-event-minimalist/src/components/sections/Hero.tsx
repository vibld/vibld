import { motion } from 'motion/react';
import { fade } from '@/lib/motion';

export default function Hero() {
  return (
    <motion.section
      id="top"
      variants={fade}
      initial="hidden"
      animate="show"
      className="mx-auto max-w-[720px] px-6 py-16 md:px-12 md:py-24"
    >
      <p className="text-small text-muted-foreground">June 7 and 8, 2025, Millbrook Park</p>
      <h1 className="mt-4 font-display text-display text-foreground text-wrap-balance">
        A weekend of food, fire and community
      </h1>
      <p className="mt-6 max-w-xl text-body text-muted-foreground text-wrap-pretty">
        Thirty cooks, two stages, one long table under the trees. Join us for a weekend of tasting plates, live fire cooking and conversations about where our food comes from.
      </p>
      <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
        <a
          href="#tickets"
          className="inline-flex h-11 items-center justify-center bg-accent px-5 text-button text-accent-foreground transition-opacity duration-150 hover:opacity-[0.85]"
        >
          Get tickets
        </a>
        <a
          href="#lineup"
          className="inline-flex h-11 items-center justify-center text-button text-accent transition-opacity duration-150 hover:opacity-[0.85]"
        >
          See the lineup
        </a>
      </div>
    </motion.section>
  );
}
