import { motion, stagger } from 'motion/react';
import type { Variants } from 'motion/react';
import { ArrowDown } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Plate } from '@/components/Plate';
import { NightFerry } from '@/components/artworks';
import { fadeScale, lift, press, pressSpring } from '@/lib/motion';

const sequence: Variants = {
  hidden: {},
  show: { transition: { delayChildren: stagger(0.08) } },
};

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="pt-6 lg:pt-12">
      <motion.div variants={sequence} initial="hidden" animate="show" className="page-x mx-auto max-w-page">
        <motion.div
          variants={fadeScale}
          style={{ transformOrigin: 'left top' }}
          className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-t border-foreground pt-3 font-mono text-label uppercase text-muted-foreground"
        >
          <span>Illustrator, Bristol UK</span>
          <span>Selected work, 2021 to 2024</span>
        </motion.div>

        <motion.h1
          id="hero-title"
          variants={fadeScale}
          style={{ transformOrigin: 'left center' }}
          className="mt-8 font-display text-display lg:mt-12"
        >
          Small worlds, painted slowly.
        </motion.h1>

        <div className="mt-8 grid gap-6 lg:mt-10 lg:grid-cols-12">
          <div className="lg:col-span-5 lg:col-start-8">
            <p className="max-w-[34rem] text-deck">
              Editorial illustration, book covers and picture books in gouache, ink and two colour risograph. Taking new
              commissions from September.
            </p>
            <motion.div
              variants={fadeScale}
              style={{ transformOrigin: 'left center' }}
              className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3"
            >
              <motion.a
                href="#work"
                whileHover={lift}
                whileTap={press}
                transition={pressSpring}
                className={buttonVariants({ size: 'lg' })}
              >
                See the work
                <ArrowDown className="size-4" aria-hidden="true" />
              </motion.a>
              <a
                href="#commissions"
                className="inline-flex min-h-11 items-center text-base underline decoration-primary decoration-1 underline-offset-4 transition-colors hover:text-primary hover:decoration-2"
              >
                Commission a picture
              </a>
            </motion.div>
          </div>
        </div>
      </motion.div>

      <Plate
        immediate
        number="01"
        caption="Night ferry. Gouache on hot pressed paper, 56 x 32 cm, 2024."
        className="mt-12 lg:mt-16"
        frameClassName="aspect-[4/5] md:aspect-[16/10] xl:aspect-[21/9]"
      >
        <NightFerry />
      </Plate>
    </section>
  );
}
