import { motion } from 'motion/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { rise } from '@/lib/motion';

const saturdayEvents = [
  { time: '11:00 AM', name: 'Gates open', location: 'Main gate', description: 'Doors open and the first vendors start serving.' },
  { time: '12:00 PM', name: 'Main stage: The Low Volts', location: 'Main stage', description: 'Opening set of analog electronica.' },
  { time: '1:30 PM', name: 'Fire cooking demo', location: 'Chef tent', description: 'Chef Maya Nguyen works through a live fire menu.' },
  { time: '3:00 PM', name: 'Miso and koji workshop', location: 'Workshop barn', description: 'Hands-on session with Miso Hungry.' },
  { time: '6:00 PM', name: 'Boiler Room Brass', location: 'Main stage', description: 'Brass house set as the evening crowd arrives.' },
  { time: '9:00 PM', name: 'Late snack market', location: 'Market hall', description: 'Night-only tasting portions from every vendor.' },
];

const sundayEvents = [
  { time: '10:00 AM', name: 'Brunch takeover', location: 'North hall', description: 'Chef Elena Rossi leads a collective brunch.' },
  { time: '12:30 PM', name: 'Shellfish fire session', location: 'Smoke yard', description: 'Chef Sam Okafor roasts oysters and clams.' },
  { time: '2:00 PM', name: 'Coffee and pastry lab', location: 'Cafe corner', description: 'Rye Baby and The Cold Press pair up.' },
  { time: '4:00 PM', name: 'Neon Drip', location: 'Second stage', description: 'Synthwave set, desserts from Chef Darius Cole.' },
  { time: '6:00 PM', name: 'Hot sauce gauntlet', location: 'Market hall', description: 'Brave the full Acid & Ember lineup.' },
  { time: '8:00 PM', name: 'DJ Sourpuss closing set', location: 'Main stage', description: 'Acid house until the generators cool down.' },
];

function EventItem({ time, name, location, description }: { time: string; name: string; location: string; description: string }) {
  return (
    <motion.div initial='hidden' whileInView='show' viewport={{ once: true, amount: 0.3 }} variants={rise} className='relative pl-8'>
      <span className='absolute left-0 top-2 size-2 rounded-full bg-primary' aria-hidden='true' />
      <Card>
        <CardHeader className='flex-row items-start justify-between gap-4'>
          <div>
            <CardTitle className='text-lg font-semibold tracking-tight'>{name}</CardTitle>
            <CardDescription>{location}</CardDescription>
          </div>
          <span className='shrink-0 text-sm font-medium text-primary'>{time}</span>
        </CardHeader>
        <CardContent>
          <p className='text-sm text-muted-foreground'>{description}</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function Schedule() {
  return (
    <div className='min-h-screen py-12 md:py-20 px-6 max-w-4xl mx-auto'>
      <motion.h1 initial='hidden' animate='show' variants={rise} className='text-[clamp(2rem,5vw,3.5rem)] leading-[1.1] tracking-[-0.03em] font-bold font-display mb-8'>Schedule</motion.h1>
      <Tabs defaultValue='saturday' className='w-full'>
        <TabsList className='mb-8'>
          <TabsTrigger value='saturday'>Saturday</TabsTrigger>
          <TabsTrigger value='sunday'>Sunday</TabsTrigger>
        </TabsList>
        <TabsContent value='saturday'>
          <div className='space-y-6'>
            {saturdayEvents.map((event) => <EventItem key={event.time} {...event} />)}
          </div>
        </TabsContent>
        <TabsContent value='sunday'>
          <div className='space-y-6'>
            {sundayEvents.map((event) => <EventItem key={event.time} {...event} />)}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
