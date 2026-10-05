import { motion } from 'motion/react';
import { User, MapPin, Mail, ArrowRight } from 'lucide-react';
import { fadeUp, staggerContainer } from '@/lib/motion';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';

export default function Bio() {
  return (
    <div className='min-h-screen bg-background text-foreground'>
      <SiteHeader />
      <main>
        <motion.section
          variants={staggerContainer}
          initial='hidden'
          animate='show'
          className='mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8'
        >
          <div className='grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20'>
            <div>
              <motion.p variants={fadeUp} className='text-sm font-medium uppercase tracking-[0.2em] text-primary'>
                About Elena
              </motion.p>
              <motion.h1
                variants={fadeUp}
                className='mt-6 font-serif text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl lg:text-6xl text-balance'
              >
                A slow eye for people, places, and objects.
              </motion.h1>
              <motion.div variants={fadeUp} className='mt-8 max-w-xl space-y-5 text-lg leading-relaxed text-muted-foreground'>
                <p>
                  I grew up in a house full of prints. My father worked in a darkroom, and I learned to read light before I learned to read words. I now photograph people, places, and things that ask for patience.
                </p>
                <p>
                  For the past twelve years I have worked with magazines, studios, and small brands across Italy. My work is quiet and unhurried. I prefer overcast mornings, north-facing windows, and honest color.
                </p>
                <p>
                  When I'm not on assignment, I'm usually driving through the Po Valley with a medium-format camera on the passenger seat.
                </p>
              </motion.div>
              <motion.div variants={fadeUp} className='mt-10'>
                <a
                  href='/contact'
                  className='inline-flex h-12 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                >
                  Get in touch
                  <ArrowRight className='h-4 w-4' aria-hidden='true' />
                </a>
              </motion.div>
            </div>

            <motion.aside variants={fadeUp} className='lg:sticky lg:top-28 lg:self-start'>
              <div className='overflow-hidden rounded-md bg-card shadow-sm'>
                <div className='relative aspect-[3/4] bg-gradient-to-br from-secondary via-muted to-background'>
                  <div className='absolute inset-0 flex items-center justify-center text-muted-foreground/60'>
                    <User className='h-16 w-16' aria-hidden='true' />
                  </div>
                </div>
                <div className='grid gap-px bg-border text-sm'>
                  <div className='flex items-center gap-3 bg-card px-5 py-4'>
                    <MapPin className='h-4 w-4 shrink-0 text-primary' aria-hidden='true' />
                    <span className='text-muted-foreground'>Based in</span>
                    <span className='ml-auto font-medium text-foreground'>Milan, Italy</span>
                  </div>
                  <div className='flex items-center gap-3 bg-card px-5 py-4'>
                    <Mail className='h-4 w-4 shrink-0 text-primary' aria-hidden='true' />
                    <span className='text-muted-foreground'>Reach me at</span>
                    <a
                      href='mailto:elena@elenamarchetti.com'
                      className='ml-auto font-medium text-primary underline-offset-4 transition-colors hover:text-primary/80 hover:underline'
                    >
                      Email
                    </a>
                  </div>
                </div>
              </div>
            </motion.aside>
          </div>
        </motion.section>
      </main>
      <SiteFooter />
    </div>
  );
}
