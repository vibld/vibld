import { motion } from 'motion/react';
import { fadeIn } from '@/lib/motion';

export default function Hero() {
  const scrollToGallery = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    document.getElementById('gallery')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <motion.section
      variants={fadeIn}
      initial="hidden"
      animate="show"
      className="max-w-[var(--page-max)] mx-auto px-[var(--gutter)] py-[var(--section-y)]"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
        <div className="order-1">
          <h1 className="font-display text-[clamp(2.8rem,6vw,4.5rem)] leading-[1.05] tracking-[-0.02em] text-foreground">
            Mara Voss
          </h1>
          <p className="mt-6 text-base leading-[1.6] text-muted-foreground max-w-md">
            Freelance photographer based in Copenhagen, working across editorial, portrait and still life.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <a
              href="#/"
              onClick={scrollToGallery}
              className="inline-flex items-center justify-center text-base font-medium text-primary underline underline-offset-4 hover:opacity-80 transition-opacity duration-150"
            >
              See recent work
            </a>
            <a
              href="#/contact"
              className="inline-flex items-center justify-center px-6 py-3 rounded-[var(--radius-field)] bg-primary text-primary-foreground text-base font-medium hover:bg-primary/90 transition-colors duration-150"
            >
              Get in touch
            </a>
          </div>
        </div>
        <div className="order-2">
          <img
            src="https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=1600&q=80"
            alt="Featured photograph by Mara Voss, editorial portrait in natural light"
            className="w-full h-auto object-cover aspect-[4/5] rounded-none"
            loading="eager"
          />
        </div>
      </div>
    </motion.section>
  );
}
