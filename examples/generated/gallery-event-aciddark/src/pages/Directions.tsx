import { motion } from 'motion/react';
import { MapPin, Bus, Car } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { rise } from '@/lib/motion';

export default function Directions() {
  return (
    <div className='min-h-screen py-12 md:py-20 px-6 max-w-4xl mx-auto'>
      <motion.h1 initial='hidden' animate='show' variants={rise} className='text-[clamp(2rem,5vw,3.5rem)] leading-[1.1] tracking-[-0.03em] font-bold font-display mb-4'>Directions</motion.h1>
      <motion.p initial='hidden' animate='show' variants={rise} className='text-muted-foreground mb-10'>Portland Expo Center, 2060 N Marine Dr, Portland, OR 97217</motion.p>

      <motion.div initial='hidden' whileInView='show' viewport={{ once: true, amount: 0.3 }} variants={rise} className='mb-10 aspect-[16/7] w-full rounded-sm border bg-muted flex items-center justify-center'>
        <MapPin className='size-8 text-muted-foreground' aria-hidden='true' />
        <span className='ml-2 text-sm text-muted-foreground'>Portland Expo Center</span>
      </motion.div>

      <div className='grid gap-6 md:grid-cols-2 mb-10'>
        <motion.div initial='hidden' whileInView='show' viewport={{ once: true, amount: 0.3 }} variants={rise} className='h-full'>
          <Card className='h-full'>
            <CardHeader className='flex-row items-center gap-3'>
              <Bus className='size-5 text-primary' aria-hidden='true' />
              <div>
                <CardTitle className='text-lg font-semibold tracking-tight'>Public transit</CardTitle>
                <CardDescription>MAX Yellow Line to Expo Center station, then a 5 minute walk.</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </motion.div>
        <motion.div initial='hidden' whileInView='show' viewport={{ once: true, amount: 0.3 }} variants={rise} className='h-full'>
          <Card className='h-full'>
            <CardHeader className='flex-row items-center gap-3'>
              <Car className='size-5 text-primary' aria-hidden='true' />
              <div>
                <CardTitle className='text-lg font-semibold tracking-tight'>Parking</CardTitle>
                <CardDescription>On-site parking at $20 per day. Bike racks at the north entrance.</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </motion.div>
      </div>

      <motion.div initial='hidden' whileInView='show' viewport={{ once: true, amount: 0.3 }} variants={rise}>
        <a href='https://www.google.com/maps/search/?api=1&query=Portland%20Expo%20Center%202060%20N%20Marine%20Dr%20Portland%20OR%2097217' target='_blank' rel='noreferrer' className={buttonVariants({ variant: 'default', size: 'lg' })}>Open in Google Maps</a>
      </motion.div>
    </div>
  );
}
