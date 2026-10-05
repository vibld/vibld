import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { fadeScale, clipWipe } from '@/lib/motion';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

export function Hero() {
  return (
    <section className="relative isolate flex min-h-screen items-center overflow-hidden">
      <motion.div
        className="absolute inset-0 -z-10"
        variants={clipWipe}
        initial="hidden"
        animate="show"
      >
        <div className="h-full w-full bg-gradient-to-br from-emerald-900 via-stone-800 to-amber-900" />
      </motion.div>
      <div className="absolute inset-0 -z-10 bg-black/50" />

      <div className="mx-auto w-full max-w-7xl px-4 py-32 sm:px-6 md:py-48 lg:px-8">
        <motion.p
          variants={fadeScale}
          initial="hidden"
          animate="show"
          className="text-sm font-medium uppercase tracking-widest text-white/80"
        >
          A weekend for people who cook, eat and talk about it
        </motion.p>
        <motion.h1
          variants={fadeScale}
          initial="hidden"
          animate="show"
          className="mt-6 font-display text-5xl tracking-tight text-white sm:text-6xl lg:text-7xl xl:text-8xl"
        >
          Savor Weekend
        </motion.h1>
        <p className="mt-6 max-w-2xl text-lg text-white/90 md:text-xl">
          Forty chefs, twelve live demos, one big table. August 15-17 at Ridgewood Park.
        </p>
        <motion.div
          variants={fadeScale}
          initial="hidden"
          animate="show"
          className="mt-10 flex flex-wrap gap-4"
        >
          <Button asChild size="lg" variant="primary">
            <Link to="/tickets">Get tickets</Link>
          </Button>
          <Link
            to="/lineup"
            className="inline-flex items-center gap-2 text-white underline-offset-4 hover:underline"
          >
            <span>See the lineup</span>
            <ArrowRight className="size-4" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
