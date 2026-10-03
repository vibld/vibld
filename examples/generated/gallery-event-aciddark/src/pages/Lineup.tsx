import { motion } from 'motion/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { rise } from '@/lib/motion';

const chefs = [
  { name: 'Chef Maya Nguyen', meta: 'Fermentation & fire', description: 'Koji, smoke, and live fire from a chef running the Pacific Northwest fermentation lab.' },
  { name: 'Chef Darius Cole', meta: 'Molecular gastronomy', description: 'Caviar spheres, liquid nitrogen, and desserts that rearrange your expectations.' },
  { name: 'Chef Elena Rossi', meta: 'Modern Italian', description: 'Handmade pasta and sharp regional flavors, reimagined with electric precision.' },
  { name: 'Chef Sam Okafor', meta: 'Smoke & shellfish', description: 'Coastal shellfish and smoldering hardwood, a study in patience and fire.' },
  { name: 'Chef Priya Patel', meta: 'Chaat lab', description: 'Street snacks deconstructed and rebuilt with popping candy and frozen tamarind.' },
];

const vendors = [
  { name: 'Acid & Ember', meta: 'Hot sauce', description: 'Small-batch sauces fermented in oak, from bright to blistering.' },
  { name: 'Miso Hungry', meta: 'Fermented goods', description: 'Miso, koji, and pickles made in Portland basements.' },
  { name: 'The Cold Press', meta: 'Juices', description: 'Cold-pressed fruit and vegetable juices, no added sugar.' },
  { name: 'Rye Baby', meta: 'Bread & pastry', description: 'Naturally leavened loaves and laminated pastries baked overnight.' },
];

const music = [
  { name: 'The Low Volts', meta: 'Electronica', description: 'Analog synths and dusty drum machines, music for late-night kitchens.' },
  { name: 'Neon Drip', meta: 'Synthwave', description: 'Retro-future synth lines and driving bass.' },
  { name: 'Boiler Room Brass', meta: 'Brass house', description: 'Trombone, sax, and house beats, a marching band gone clubbing.' },
  { name: 'DJ Sourpuss', meta: 'Acid house', description: '303 squelch and warehouse energy, closing out the main stage.' },
];

function EntryCard({ name, meta, description }: { name: string; meta: string; description: string }) {
  return (
    <motion.div initial='hidden' animate='show' variants={rise} className='h-full'>
      <Card className='h-full'>
        <CardHeader>
          <CardTitle className='text-lg font-semibold tracking-tight'>{name}</CardTitle>
          <CardDescription>{meta}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className='text-sm text-muted-foreground'>{description}</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function Lineup() {
  return (
    <div className='min-h-screen py-12 md:py-20 px-6 max-w-6xl mx-auto'>
      <h1 className='text-[clamp(2rem,5vw,3.5rem)] leading-[1.1] tracking-[-0.03em] font-bold font-display mb-8'>Lineup</h1>
      <Tabs defaultValue='chefs' className='w-full'>
        <TabsList className='mb-6'>
          <TabsTrigger value='chefs'>Chefs</TabsTrigger>
          <TabsTrigger value='vendors'>Vendors</TabsTrigger>
          <TabsTrigger value='music'>Music</TabsTrigger>
        </TabsList>
        <TabsContent value='chefs'>
          <div className='grid gap-6 md:grid-cols-2'>
            {chefs.map((item) => <EntryCard key={item.name} name={item.name} meta={item.meta} description={item.description} />)}
          </div>
        </TabsContent>
        <TabsContent value='vendors'>
          <div className='grid gap-6 md:grid-cols-2'>
            {vendors.map((item) => <EntryCard key={item.name} name={item.name} meta={item.meta} description={item.description} />)}
          </div>
        </TabsContent>
        <TabsContent value='music'>
          <div className='grid gap-6 md:grid-cols-2'>
            {music.map((item) => <EntryCard key={item.name} name={item.name} meta={item.meta} description={item.description} />)}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
