import { useState } from 'react';
import type { FormEvent } from 'react';
import { motion } from 'motion/react';
import type { Variants } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const easeOut: [number, number, number, number] = [0.23, 1, 0.32, 1];

const contactGlass: Variants = {
  hidden: { opacity: 0, scale: 0.98, backdropFilter: 'blur(0px)' },
  show: {
    opacity: 1,
    scale: 1,
    backdropFilter: 'blur(24px)',
    transition: { duration: 0.25, ease: easeOut },
  },
};

type SubmitStatus = 'idle' | 'sending' | 'sent';

export default function Contact() {
  const [status, setStatus] = useState<SubmitStatus>('idle');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === 'sending') return;
    setStatus('sending');
    await new Promise((resolve) => setTimeout(resolve, 900));
    setStatus('sent');
  };

  return (
    <section id='contact' className='mx-auto w-full max-w-[1000px] px-[clamp(20px,4vw,48px)] py-[clamp(72px,10vw,140px)]'>
      <motion.div
        variants={contactGlass}
        initial='hidden'
        whileInView='show'
        viewport={{ once: true, amount: 0.2 }}
        className='glass-strong rounded-glass p-6 sm:p-12'
      >
        <h2 className='font-display text-section font-semibold tracking-tight text-foreground'>Work with me</h2>
        <p className='mt-4 max-w-xl text-body text-muted-foreground'>Tell me about your project, your dates and where you are based. I will reply when I can.</p>

        <form onSubmit={handleSubmit} className='mt-8 space-y-6' noValidate>
          <div className='grid grid-cols-1 gap-6 sm:grid-cols-2'>
            <div>
              <label htmlFor='name' className='mb-2 block text-sm font-medium text-foreground'>Your name</label>
              <input
                id='name'
                name='name'
                type='text'
                required
                className='h-11 w-full rounded-pill border border-border bg-muted px-4 text-body text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1'
                placeholder='Mara Voss'
              />
            </div>
            <div>
              <label htmlFor='email' className='mb-2 block text-sm font-medium text-foreground'>Email address</label>
              <input
                id='email'
                name='email'
                type='email'
                required
                className='h-11 w-full rounded-pill border border-border bg-muted px-4 text-body text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1'
                placeholder='hello@example.com'
              />
            </div>
          </div>

          <div>
            <label htmlFor='message' className='mb-2 block text-sm font-medium text-foreground'>Message</label>
            <textarea
              id='message'
              name='message'
              rows={5}
              required
              className='w-full rounded-image border border-border bg-muted px-4 py-3 text-body text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 resize-y'
              placeholder='Tell me about the shoot, dates and location.'
            />
          </div>

          <div className='flex flex-col gap-4 sm:flex-row sm:items-center'>
            <Button type='submit' disabled={status === 'sending'} className='w-full sm:w-auto' size='lg'>
              {status === 'sending' && <Loader2 className='size-4 animate-spin motion-reduce:animate-none' />}
              {status === 'sending' ? 'Sending...' : 'Send message'}
            </Button>
            {status === 'sent' && (
              <p className='text-sm text-primary' role='status'>
                Thanks, your message is ready to send. This form is a demonstration and does not deliver yet.
              </p>
            )}
          </div>
        </form>

        <a href='mailto:hello@maravoss.photo' className='mt-6 inline-block text-sm font-medium text-foreground underline-offset-4 hover:text-primary hover:underline'>
          Prefer email? Write to hello@maravoss.photo
        </a>
      </motion.div>
    </section>
  );
}
