import { useState } from 'react';
import type { FormEvent } from 'react';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { rise } from '@/lib/motion';

const ticketOptions = [
  { name: 'Single day', price: '$65', description: 'Admission for one day, all stages and vendors.' },
  { name: 'Weekend', price: '$120', description: 'Both days, early entry, and a festival tote.' },
  { name: 'VIP', price: '$220', description: 'Weekend pass plus reserved stage viewing and late-night tastings.' },
];

export default function Tickets() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  const handleBuy = (name: string) => {
    setSelected(name);
    setCompleted(false);
    setEmailError(null);
    setOpen(true);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    if (!email.includes('@')) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmailError(null);
    setSubmitting(true);
    window.setTimeout(() => {
      setSubmitting(false);
      setCompleted(true);
    }, 800);
  };

  return (
    <div className='min-h-screen py-12 md:py-20 px-6 max-w-5xl mx-auto'>
      <motion.h1 initial='hidden' animate='show' variants={rise} className='text-[clamp(2rem,5vw,3.5rem)] leading-[1.1] tracking-[-0.03em] font-bold font-display mb-4'>Tickets</motion.h1>
      <motion.p initial='hidden' animate='show' variants={rise} className='text-muted-foreground mb-10 max-w-2xl'>Weekend and single-day passes. Early bird ends July 15. Every pass includes all stages and the market hall.</motion.p>

      <div className='grid gap-6 md:grid-cols-3'>
        {ticketOptions.map((ticket, index) => (
          <motion.div key={ticket.name} initial='hidden' whileInView='show' viewport={{ once: true, amount: 0.3 }} variants={rise} transition={{ delay: index * 0.05 }} className='h-full'>
            <Card className='flex h-full flex-col'>
              <CardHeader>
                <CardTitle className='text-lg font-semibold tracking-tight'>{ticket.name}</CardTitle>
                <CardDescription>{ticket.description}</CardDescription>
              </CardHeader>
              <CardContent className='flex-1'>
                <p className='text-3xl font-bold font-display text-foreground'>{ticket.price}</p>
              </CardContent>
              <CardFooter className='pt-0'>
                <Button size='lg' className='w-full' onClick={() => handleBuy(ticket.name)}>Buy</Button>
              </CardFooter>
            </Card>
          </motion.div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {completed ? (
            <>
              <DialogHeader>
                <DialogTitle>Pass reserved</DialogTitle>
                <DialogDescription>We sent a confirmation to your email. This demo does not charge a card.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant='secondary' onClick={() => setOpen(false)}>Close</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Buy {selected ?? 'a pass'}</DialogTitle>
                <DialogDescription>This form is a demonstration. No payment is processed.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className='space-y-4'>
                <div>
                  <label htmlFor='name' className='mb-1.5 block text-sm font-medium text-foreground'>Name</label>
                  <input id='name' name='name' required placeholder='Your name' className='h-11 w-full rounded-sm border bg-background px-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring' />
                </div>
                <div>
                  <label htmlFor='email' className='mb-1.5 block text-sm font-medium text-foreground'>Email</label>
                  <input id='email' name='email' type='email' required placeholder='you@example.com' className='h-11 w-full rounded-sm border bg-background px-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring' />
                  {emailError && <p role='alert' className='mt-1.5 text-sm text-destructive'>{emailError}</p>}
                </div>
                <DialogFooter>
                  <Button type='submit' size='lg' disabled={submitting}>
                    {submitting && <Loader2 className='animate-spin motion-reduce:animate-none' aria-hidden='true' />}
                    {submitting ? 'Reserving...' : 'Reserve pass'}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
