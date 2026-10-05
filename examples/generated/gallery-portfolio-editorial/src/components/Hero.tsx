import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { heroStagger, heroItem, clipRevealLeft } from '@/lib/motion';

export function Hero() {
  const words = 'Moments held still, before they change.'.split(' ');

  return (
    <section id='hero' className='grid min-h-svh grid-cols-1 bg-background lg:grid-cols-2'>
      <div className='order-2 flex items-center px-6 py-12 lg:order-1 lg:px-16 lg:py-24'>
        <motion.div variants={heroStagger} initial='hidden' animate='show' className='max-w-xl'>
          <motion.p variants={heroItem} className='text-sm font-medium uppercase tracking-[0.08em] text-accent'>
            Freelance photographer
          </motion.p>
          <h1 className='mt-5 font-display text-hero leading-[1.0] tracking-[-0.04em] text-foreground'>
            {words.map((word, index) => (
              <motion.span key={index} variants={heroItem} className='mr-[0.25em] inline-block'>
                {word}
              </motion.span>
            ))}
          </h1>
          <motion.p variants={heroItem} className='mt-6 text-lg leading-relaxed text-muted-foreground'>
            Editorial and commercial photography for magazines, brands, and people who want the real thing.
          </motion.p>
          <motion.div variants={heroItem} className='mt-8 flex flex-wrap gap-4'>
            <Button asChild size='lg'>
              <a href='#work'>View recent work</a>
            </Button>
            <Button asChild variant='ghost' size='lg'>
              <a href='#about'>About Lena</a>
            </Button>
          </motion.div>
        </motion.div>
      </div>
      <div className='order-1 relative h-[60svh] w-full overflow-hidden lg:order-2 lg:h-auto'>
        <motion.div variants={clipRevealLeft} initial='hidden' animate='show' className='absolute inset-0 h-full w-full'>
          <img src='https://picsum.photos/seed/hero/1600/2000' alt='Featured photograph by Lena Voss' className='h-full w-full object-cover' />
        </motion.div>
      </div>
    </section>
  );
}
