import { motion } from 'motion/react';
import { scaleIn, riseIn } from '@/lib/motion';

export default function Bio() {
  return (
    <section id='bio' className='mx-auto w-full max-w-[1000px] px-[clamp(20px,4vw,48px)] py-[clamp(72px,10vw,140px)]'>
      <div className='grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-12'>
        <motion.div variants={scaleIn} initial='hidden' whileInView='show' viewport={{ once: true, amount: 0.3 }} className='overflow-hidden rounded-image border border-border bg-muted'>
          <img
            src='https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=1000&q=80'
            alt='Mara Voss holding a camera in her Lisbon studio'
            className='aspect-[4/5] h-full w-full object-cover'
          />
        </motion.div>
        <motion.div variants={riseIn} initial='hidden' whileInView='show' viewport={{ once: true, amount: 0.3 }} className='flex flex-col justify-center'>
          <h2 className='font-display text-section font-semibold tracking-tight text-foreground'>About me</h2>
          <p className='mt-5 text-body text-muted-foreground'>I am Mara Voss, a freelance photographer based in Lisbon. I started with a film camera in my grandfather's attic and now shoot portraits, editorial work and live performances for clients who want images that feel unhurried.</p>
          <p className='mt-4 text-body text-muted-foreground'>When I am not behind a camera, I am developing film, walking the Alfama with a notebook, or chasing late light along the Tagus.</p>
        </motion.div>
      </div>
    </section>
  );
}
