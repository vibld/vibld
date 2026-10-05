import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { fadeUp, clipRevealLeft, staggerContainer } from '@/lib/motion';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export function About() {
  return (
    <section id='about' className='bg-secondary/50 py-24 md:py-32'>
      <div className='mx-auto grid max-w-6xl grid-cols-1 gap-12 px-6 md:grid-cols-5 md:gap-12 lg:px-8'>
        <motion.div
          variants={clipRevealLeft}
          initial='hidden'
          whileInView='show'
          viewport={{ once: true, amount: 0.3 }}
          className='relative md:col-span-2'
        >
          <div className='relative overflow-hidden bg-secondary'>
            <img
              src='https://picsum.photos/seed/portrait/1200/1500'
              alt='Portrait of Lena Voss'
              className='h-full w-full object-cover aspect-[4/5]'
            />
          </div>
        </motion.div>
        <motion.div
          variants={staggerContainer}
          initial='hidden'
          whileInView='show'
          viewport={{ once: true, amount: 0.3 }}
          className='flex flex-col justify-center md:col-span-3'
        >
          <motion.h2 variants={fadeUp} className='font-display text-section-title text-foreground'>
            About Lena
          </motion.h2>
          <motion.p variants={fadeUp} className='mt-6 text-body leading-[1.6] text-muted-foreground'>
            I am a freelance photographer based in Copenhagen, working across editorial, portrait, and documentary assignments. I wait for the moment to arrive instead of forcing it.
          </motion.p>
          <motion.p variants={fadeUp} className='mt-4 text-body leading-[1.6] text-muted-foreground'>
            Before going independent, I spent six years as a photo editor at a monthly magazine, where I learned what a story needs to stand on its own. That training shapes every assignment I take on.
          </motion.p>
          <motion.blockquote
            variants={fadeUp}
            transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.12 }}
            className='mt-8 border-l-2 border-accent pl-6 font-display text-pullquote leading-snug text-foreground'
          >
            A good photo is a question, not an answer.
          </motion.blockquote>
          <motion.div variants={fadeUp} className='mt-8'>
            <Button asChild size='lg'>
              <a href='#contact'>Get in touch</a>
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
