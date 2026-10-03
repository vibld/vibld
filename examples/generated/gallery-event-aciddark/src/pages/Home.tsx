import { Link } from 'react-router-dom';
import { motion, type Variants } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { rise, fadeIn } from '@/lib/motion';

const heroContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.06,
    },
  },
};

export default function Home() {
  return (
    <>
      <section className='min-h-screen flex flex-col justify-center items-center text-center max-w-3xl mx-auto px-6 py-20'>
        <motion.div variants={heroContainer} initial='hidden' animate='show' className='flex flex-col items-center gap-6'>
          <motion.h1 variants={rise} className='text-[clamp(3.5rem,10vw,7rem)] leading-[0.95] tracking-[-0.04em] font-bold font-display'>Electric Fork Festival</motion.h1>
          <motion.p variants={rise} className='text-lg md:text-xl text-muted-foreground max-w-xl'>Bold flavors. Acid beats. Two days of food that bites back.</motion.p>
          <motion.p variants={rise} className='text-sm font-medium uppercase tracking-widest text-muted-foreground'>August 23-24 / Portland, OR</motion.p>
          <motion.div variants={rise} className='flex flex-wrap justify-center gap-4 mt-4'>
            <Link to='/tickets' className={buttonVariants({ variant: 'default', size: 'lg' })}>Get Tickets</Link>
            <Link to='/lineup' className={buttonVariants({ variant: 'secondary', size: 'lg' })}>See Lineup</Link>
          </motion.div>
          <motion.p variants={rise} className='text-sm text-muted-foreground'>Weekend pass from $85</motion.p>
        </motion.div>
      </section>

      <section className='py-12 md:py-20 px-6'>
        <motion.div initial='hidden' whileInView='show' viewport={{ once: true, amount: 0.3 }} variants={rise} className='max-w-6xl mx-auto grid gap-12 md:grid-cols-2 md:items-center'>
          <div>
            <h2 className='text-[clamp(1.5rem,3vw,2.25rem)] leading-tight tracking-[-0.02em] font-bold font-display mb-4'>What is Electric Fork?</h2>
            <p className='text-base text-muted-foreground'>A weekend of experimental cuisine, live music, and local vendors pushing the boundaries of taste. 40 chefs, 20 stages, one electric atmosphere.</p>
          </div>
          <motion.div initial='hidden' whileInView='show' viewport={{ once: true, amount: 0.3 }} variants={fadeIn} className='aspect-[4/3] w-full bg-card border border-border rounded-sm flex items-center justify-center'>
            <p className='text-sm text-muted-foreground'>40 chefs / 20 stages</p>
          </motion.div>
        </motion.div>
      </section>

      <section className='py-12 md:py-20 px-6'>
        <motion.div initial='hidden' whileInView='show' viewport={{ once: true, amount: 0.3 }} variants={rise} className='max-w-6xl mx-auto'>
          <div className='flex items-baseline justify-between mb-8'>
            <h2 className='text-[clamp(1.5rem,3vw,2.25rem)] leading-tight tracking-[-0.02em] font-bold font-display'>Chefs to watch</h2>
            <Link to='/lineup' className='inline-flex items-center gap-2 text-primary hover:underline text-sm font-medium'>
              Full lineup <ArrowRight className='size-4' aria-hidden='true' />
            </Link>
          </div>
          <div className='grid gap-6 md:grid-cols-3'>
            {[
              { name: 'Chef Maya Nguyen', style: 'Fermentation & fire' },
              { name: 'Chef Darius Cole', style: 'Molecular gastronomy' },
              { name: 'Chef Elena Rossi', style: 'Modern Italian' },
            ].map((chef) => (
              <Card key={chef.name} className='h-full'>
                <CardHeader>
                  <CardTitle className='text-lg font-semibold tracking-tight'>{chef.name}</CardTitle>
                  <CardDescription>{chef.style}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className='text-sm text-muted-foreground'>Experimental and boundary-pushing.</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </motion.div>
      </section>

      <section className='py-12 md:py-20 px-6'>
        <motion.div initial='hidden' whileInView='show' viewport={{ once: true, amount: 0.3 }} variants={rise} className='max-w-3xl mx-auto'>
          <div className='flex items-baseline justify-between mb-8'>
            <h2 className='text-[clamp(1.5rem,3vw,2.25rem)] leading-tight tracking-[-0.02em] font-bold font-display'>Weekend Schedule</h2>
            <Link to='/schedule' className='inline-flex items-center gap-2 text-primary hover:underline text-sm font-medium'>
              Full schedule <ArrowRight className='size-4' aria-hidden='true' />
            </Link>
          </div>
          <div className='grid gap-6 md:grid-cols-2'>
            <Card>
              <CardHeader>
                <CardTitle className='text-lg font-semibold tracking-tight'>Saturday</CardTitle>
                <CardDescription>Gates at 11 AM, music starts at noon</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className='text-lg font-semibold tracking-tight'>Sunday</CardTitle>
                <CardDescription>Brunch takeover, closing set at 8 PM</CardDescription>
              </CardHeader>
            </Card>
          </div>
        </motion.div>
      </section>

      <section className='py-12 md:py-20 px-6'>
        <motion.div initial='hidden' whileInView='show' viewport={{ once: true, amount: 0.3 }} variants={rise} className='max-w-xl mx-auto'>
          <Card className='p-10 text-center'>
            <CardContent className='p-0'>
              <h2 className='text-[clamp(1.5rem,3vw,2.25rem)] leading-tight tracking-[-0.02em] font-bold font-display mb-4'>Get your pass</h2>
              <p className='text-muted-foreground mb-6'>Weekend and single-day passes. Early bird ends July 15.</p>
              <Link to='/tickets' className={buttonVariants({ variant: 'default', size: 'lg' })}>Buy Tickets</Link>
              <p className='text-sm text-muted-foreground mt-4'>Weekend: $120, Single day: $65</p>
            </CardContent>
          </Card>
        </motion.div>
      </section>

      <section className='py-12 md:py-20 px-6'>
        <motion.div initial='hidden' whileInView='show' viewport={{ once: true, amount: 0.3 }} variants={rise} className='max-w-xl mx-auto text-center'>
          <h2 className='text-[clamp(1.5rem,3vw,2.25rem)] leading-tight tracking-[-0.02em] font-bold font-display mb-4'>Getting there</h2>
          <p className='text-muted-foreground mb-6'>Portland Expo Center, 2060 N Marine Dr, Portland, OR 97217</p>
          <Link to='/directions' className='inline-flex items-center gap-2 text-primary hover:underline text-sm font-medium'>
            Directions <ArrowRight className='size-4' aria-hidden='true' />
          </Link>
        </motion.div>
      </section>
    </>
  );
}
