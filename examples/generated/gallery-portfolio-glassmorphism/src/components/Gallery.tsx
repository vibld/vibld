import { useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { staggerContainer, scaleIn, riseIn } from '@/lib/motion';

type Category = 'All' | 'Portraits' | 'Places' | 'Live';

interface GalleryItem {
  src: string;
  alt: string;
  category: Exclude<Category, 'All'>;
  span: string;
}

const items: GalleryItem[] = [
  {
    src: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=1200&q=80',
    alt: 'Portrait of a woman in natural window light',
    category: 'Portraits',
    span: 'lg:col-span-7',
  },
  {
    src: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=1200&q=80',
    alt: 'Foggy mountain road at dawn',
    category: 'Places',
    span: 'lg:col-span-5',
  },
  {
    src: 'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1200&q=80',
    alt: 'Singer on stage with red light',
    category: 'Live',
    span: 'lg:col-span-5',
  },
  {
    src: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=1200&q=80',
    alt: 'Close portrait of a man in a studio',
    category: 'Portraits',
    span: 'lg:col-span-7',
  },
  {
    src: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
    alt: 'Coastal cliffs in late afternoon',
    category: 'Places',
    span: 'lg:col-span-4',
  },
  {
    src: 'https://images.unsplash.com/photo-1519892300165-cb5542fb47c7?auto=format&fit=crop&w=1200&q=80',
    alt: 'Drummer mid-song at a club show',
    category: 'Live',
    span: 'lg:col-span-4',
  },
  {
    src: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80',
    alt: 'Woman laughing at a market stall',
    category: 'Portraits',
    span: 'lg:col-span-4',
  },
  {
    src: 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?auto=format&fit=crop&w=1200&q=80',
    alt: 'Old tram on a Lisbon street',
    category: 'Places',
    span: 'lg:col-span-12',
  },
];

const filters: Category[] = ['All', 'Portraits', 'Places', 'Live'];

export default function Gallery() {
  const [active, setActive] = useState<Category>('All');
  const [selected, setSelected] = useState<GalleryItem | null>(null);

  const filteredItems = active === 'All' ? items : items.filter((item) => item.category === active);

  return (
    <section id='gallery' className='mx-auto w-full max-w-[1200px] px-[clamp(20px,4vw,48px)] py-[clamp(72px,10vw,140px)]'>
      <motion.div variants={riseIn} initial='hidden' whileInView='show' viewport={{ once: true, amount: 0.3 }}>
        <h2 className='font-display text-section font-semibold tracking-tight text-foreground'>Recent work</h2>
        <p className='mt-4 max-w-xl text-body text-muted-foreground'>A selection of portraits, places and live shows from the last two years.</p>
      </motion.div>

      <div className='mt-8 flex flex-wrap gap-3'>
        {filters.map((filter) => (
          <motion.button
            key={filter}
            type='button'
            aria-pressed={active === filter}
            onClick={() => setActive(filter)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className={cn(buttonVariants({ variant: active === filter ? 'default' : 'outline', size: 'sm' }), 'min-h-11')}
          >
            {filter}
          </motion.button>
        ))}
      </div>

      <motion.div
        variants={staggerContainer}
        initial='hidden'
        whileInView='show'
        viewport={{ once: true, amount: 0.2 }}
        className='mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12'
      >
        {filteredItems.map((item) => (
          <motion.button
            key={item.src}
            variants={scaleIn}
            onClick={() => setSelected(item)}
            aria-label={`Open image: ${item.alt}`}
            className={cn(
              'group relative overflow-hidden rounded-image border border-border bg-muted text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              item.span,
              'sm:col-span-1'
            )}
          >
            <img
              src={item.src}
              alt={item.alt}
              loading='lazy'
              className='h-64 w-full object-cover transition-transform duration-500 group-hover:scale-105 sm:h-72 lg:h-80'
            />
            <div className='absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100' aria-hidden='true' />
            <span className='absolute bottom-3 left-3 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100'>{item.alt}</span>
          </motion.button>
        ))}
      </motion.div>

      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className='max-w-4xl rounded-image border-glass-border bg-background p-4 sm:p-6'>
          <DialogTitle className='sr-only'>{selected?.alt ?? 'Photograph'}</DialogTitle>
          <DialogDescription className='sr-only'>{selected?.alt ?? 'Photograph details'}</DialogDescription>
          {selected && (
            <>
              <img src={selected.src} alt={selected.alt} className='max-h-[70vh] w-full rounded-image bg-muted object-contain' />
              <p className='mt-4 text-sm text-muted-foreground'>{selected.alt}</p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
