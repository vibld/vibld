import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { Loader2, CheckCircle2 } from 'lucide-react';

import SiteLayout from '@/components/SiteLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { fadeUp } from '@/lib/motion';

type FormStatus = 'idle' | 'loading' | 'success';
type FormErrors = { name?: string; email?: string; message?: string };

export default function Contact() {
  const [formData, setFormData] = useState({ name: '', email: '', message: '' });
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<FormStatus>('idle');

  function validate(data: typeof formData): FormErrors {
    const next: FormErrors = {};
    if (!data.name.trim()) next.name = 'Please enter your name.';
    if (!data.email.trim()) next.email = 'Please enter your email address.';
    else if (!data.email.includes('@')) next.email = 'Please enter a valid email address.';
    if (!data.message.trim()) next.message = 'Please tell us briefly about your challenge.';
    else if (data.message.trim().length < 10) next.message = 'Please add a little more detail.';
    return next;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validate(formData);
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      setStatus('idle');
      return;
    }
    setStatus('loading');
    await new Promise((resolve) => setTimeout(resolve, 900));
    setStatus('success');
    setFormData({ name: '', email: '', message: '' });
  }

  return (
    <SiteLayout>
      <section className='mx-auto w-full max-w-[600px] px-6 py-20 sm:py-24'>
        <motion.div variants={fadeUp} initial='hidden' whileInView='show' viewport={{ once: true, amount: 0.3 }}>
          <h1 className='font-display text-4xl font-bold tracking-tight text-primary sm:text-5xl'>Start a conversation</h1>
          <p className='mt-5 text-lg leading-relaxed text-muted-foreground'>
            Tell us about your challenge. We'll respond within two business days.
          </p>
          <form onSubmit={handleSubmit} className='mt-10 space-y-6' noValidate>
            {status === 'success' && (
              <div className='flex items-start gap-3 rounded-md border border-border bg-muted p-4 text-sm text-foreground' role='status'>
                <CheckCircle2 className='mt-0.5 h-5 w-5 shrink-0 text-accent' aria-hidden='true' />
                <p>Thank you. This demonstration form does not send messages. In a live site, we would reply within two business days.</p>
              </div>
            )}
            <div className='space-y-2'>
              <Label htmlFor='name'>Name</Label>
              <Input
                id='name'
                name='name'
                value={formData.name}
                onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))}
                placeholder='Your full name'
                disabled={status === 'loading' || status === 'success'}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? 'name-error' : undefined}
              />
              {errors.name && (
                <p id='name-error' className='mt-2 text-sm text-accent' role='alert'>
                  {errors.name}
                </p>
              )}
            </div>
            <div className='space-y-2'>
              <Label htmlFor='email'>Email</Label>
              <Input
                id='email'
                name='email'
                type='email'
                value={formData.email}
                onChange={(event) => setFormData((current) => ({ ...current, email: event.target.value }))}
                placeholder='you@example.com'
                disabled={status === 'loading' || status === 'success'}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'email-error' : undefined}
              />
              {errors.email && (
                <p id='email-error' className='mt-2 text-sm text-accent' role='alert'>
                  {errors.email}
                </p>
              )}
            </div>
            <div className='space-y-2'>
              <Label htmlFor='message'>Message</Label>
              <Textarea
                id='message'
                name='message'
                value={formData.message}
                onChange={(event) => setFormData((current) => ({ ...current, message: event.target.value }))}
                placeholder='Tell us about your challenge'
                disabled={status === 'loading' || status === 'success'}
                aria-invalid={Boolean(errors.message)}
                aria-describedby={errors.message ? 'message-error' : undefined}
              />
              {errors.message && (
                <p id='message-error' className='mt-2 text-sm text-accent' role='alert'>
                  {errors.message}
                </p>
              )}
            </div>
            <Button type='submit' disabled={status === 'loading' || status === 'success'} className='w-full sm:w-auto'>
              {status === 'loading' && <Loader2 className='animate-spin motion-reduce:animate-none' aria-hidden='true' />}
              {status === 'loading' ? 'Sending...' : status === 'success' ? 'Message sent' : 'Send message'}
            </Button>
            <p className='text-sm text-muted-foreground'>This form is a demonstration. No message is sent or stored.</p>
          </form>
        </motion.div>
      </section>
    </SiteLayout>
  );
}
