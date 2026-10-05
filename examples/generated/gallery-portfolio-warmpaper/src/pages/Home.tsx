import { useEffect, useRef } from 'react';
import { motion, useMotionValue, useSpring } from 'motion/react';
import { fadeUp, staggerContainer } from '@/lib/motion';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import PhotoCard from '@/components/PhotoCard';

const photos = [
  { title: `Villa d'Este, morning`, category: 'Editorial', year: '2025' },
  { title: 'Objects for a slow kitchen', category: 'Still life', year: '2025' },
  { title: 'Portrait of Livia', category: 'Portrait', year: '2024' },
  { title: 'Harvest, Puglia', category: 'Documentary', year: '2024' },
  { title: 'A room in Turin', category: 'Architecture', year: '2023' },
  { title: 'The last botanist', category: 'Editorial', year: '2023' },
];

export default function Home() {
  const isFine = useRef(false);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springX = useSpring(mouseX, { stiffness: 80, damping: 20 });
  const springY = useSpring(mouseY, { stiffness: 80, damping: 20 });

  useEffect(() => {
    const media = window.matchMedia('(pointer: fine)');
    isFine.current = media.matches;
    const onChange = (event: MediaQueryListEvent) => {
      isFine.current = event.matches;
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return (
    <div className='min-h-screen bg-background text-foreground'>
      <SiteHeader />
      <main>
        <motion.section
          variants={staggerContainer}
          initial='hidden'
          animate='show'
          onPointerMove={(event) => {
            if (!isFine.current) return;
            const rect = event.currentTarget.getBoundingClientRect();
            mouseX.set(event.clientX - rect.left - rect.width / 2);
            mouseY.set(event.clientY - rect.top - rect.height / 2);
          }}
          className='relative overflow-hidden border-b border-border'
        >
          <motion.div
            aria-hidden='true'
            style={{ x: springX, y: springY }}
            className='pointer-events-none absolute -top-32 -left-32 h-80 w-80 rounded-full bg-primary/10 blur-3xl'
          />
          <div className='relative mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8'>
            <motion.p variants={fadeUp} className='text-sm font-medium uppercase tracking-[0.2em] text-primary'>
              Milan, Italy
            </motion.p>
            <motion.h1
              variants={fadeUp}
              className='mt-6 max-w-4xl font-serif text-5xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl text-balance'
            >
              Photographs with patience and a warm eye.
            </motion.h1>
            <motion.p
              variants={fadeUp}
              className='mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl'
            >
              I make quiet, considered images for magazines, brands, and people who want to be seen clearly.
            </motion.p>
            <motion.div variants={fadeUp} className='mt-10 flex flex-wrap items-center gap-4'>
              <a
                href='#work'
                className='inline-flex h-12 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              >
                See selected work
              </a>
              <a
                href='/contact'
                className='inline-flex h-12 items-center justify-center rounded-md border border-border bg-card px-6 text-sm font-medium text-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              >
                Get in touch
              </a>
            </motion.div>
          </div>
        </motion.section>

        <section id='work' className='mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:px-8'>
          <div className='max-w-2xl'>
            <motion.p
              variants={fadeUp}
              initial='hidden'
              whileInView='show'
              viewport={{ once: true, amount: 0.3 }}
              className='text-sm font-medium uppercase tracking-[0.2em] text-primary'
            >
              Selected work
            </motion.p>
            <motion.h2
              variants={fadeUp}
              initial='hidden'
              whileInView='show'
              viewport={{ once: true, amount: 0.3 }}
              className='mt-3 font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl lg:text-5xl text-balance'
            >
              Recent commissions and personal projects
            </motion.h2>
            <motion.p
              variants={fadeUp}
              initial='hidden'
              whileInView='show'
              viewport={{ once: true, amount: 0.3 }}
              className='mt-4 text-lg leading-relaxed text-muted-foreground'
            >
              A few frames from the last three years, in no particular order.
            </motion.p>
          </div>

          <div className='mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3'>
            {photos.map((photo) => (
              <PhotoCard
                key={photo.title}
                title={photo.title}
                category={photo.category}
                year={photo.year}
              />
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
