import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { fadeUp, clipRevealBottom, staggerContainer } from '@/lib/motion';

type GalleryItem = {
  src: string;
  alt: string;
  caption: string;
  span: string;
  imageClass: string;
  overlay?: boolean;
};

const items: GalleryItem[] = [
  {
    src: 'https://picsum.photos/seed/coastal-light/1200/1500',
    alt: 'Coastal Light editorial photograph',
    caption: 'Coastal Light, Editorial, 2025',
    span: 'sm:col-span-2 lg:col-span-7 lg:row-span-2',
    imageClass: 'aspect-[4/5] lg:aspect-auto lg:h-full',
  },
  {
    src: 'https://picsum.photos/seed/studio-portrait/1200/1500',
    alt: 'Studio Portrait photograph',
    caption: 'Studio Portrait, Portrait, 2025',
    span: 'sm:col-span-1 lg:col-span-5',
    imageClass: 'aspect-[4/3]',
  },
  {
    src: 'https://picsum.photos/seed/market-day/1200/1500',
    alt: 'Market Day documentary photograph',
    caption: 'Market Day, Documentary, 2024',
    span: 'sm:col-span-1 lg:col-span-5',
    imageClass: 'aspect-[4/3]',
  },
  {
    src: 'https://picsum.photos/seed/quiet-interiors/1600/900',
    alt: 'Quiet Interiors interior photograph',
    caption: 'Quiet Interiors, Interior, 2024',
    span: 'sm:col-span-2 lg:col-span-12',
    imageClass: 'aspect-[16/9]',
    overlay: true,
  },
  {
    src: 'https://picsum.photos/seed/lines-city/1200/1500',
    alt: 'Lines of the City architecture photograph',
    caption: 'Lines of the City, Architecture, 2024',
    span: 'sm:col-span-1 lg:col-span-5',
    imageClass: 'aspect-[4/3]',
  },
  {
    src: 'https://picsum.photos/seed/after-rain/1200/1500',
    alt: 'After Rain landscape photograph',
    caption: 'After Rain, Landscape, 2025',
    span: 'sm:col-span-1 lg:col-span-5',
    imageClass: 'aspect-[4/3]',
  },
];

export function Gallery() {
  return (
    <section id='work' className='py-24 md:py-32'>
      <div className='mx-auto max-w-[1440px] px-6 md:px-8'>
        <motion.h2
          variants={fadeUp}
          initial='hidden'
          whileInView='show'
          viewport={{ once: true, amount: 0.3 }}
          className='font-display text-section-title text-foreground'
        >
          Recent work
        </motion.h2>
        <motion.div
          variants={staggerContainer}
          initial='hidden'
          whileInView='show'
          viewport={{ once: true, amount: 0.2 }}
          className='mt-12 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-12 lg:gap-8'
        >
          {items.map((item) => (
            <motion.figure key={item.src} variants={clipRevealBottom} className={cn('flex flex-col', item.span)}>
              <div className={cn('relative overflow-hidden bg-secondary', item.imageClass)}>
                <img src={item.src} alt={item.alt} loading='lazy' className='h-full w-full object-cover' />
                {item.overlay && (
                  <div className='absolute inset-0 flex items-end bg-overlay p-6 md:p-10'>
                    <blockquote className='font-display text-pullquote leading-tight text-primary-foreground'>
                      The best frame is the one that still breathes.
                    </blockquote>
                  </div>
                )}
              </div>
              <figcaption className='pt-3 font-body text-caption uppercase tracking-[0.02em] text-muted-foreground'>
                {item.caption}
              </figcaption>
            </motion.figure>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
