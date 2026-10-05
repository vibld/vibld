import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { fadeUp, staggerContainer } from '@/lib/motion';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

type FormErrors = {
  name?: string;
  email?: string;
  message?: string;
};

export default function Contact() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<'idle' | 'sending' | 'success'>('idle');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const newErrors: FormErrors = {};
    if (!name.trim()) newErrors.name = 'Please tell me your name.';
    if (!email.trim()) {
      newErrors.email = 'Please include an email so I can reply.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = "That email doesn't look right. Please check it.";
    }
    if (!message.trim()) newErrors.message = 'A short note about what you have in mind helps.';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    setStatus('sending');
    // Simulate sending because this is a demonstration.
    setTimeout(() => {
      setStatus('success');
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
        <motion.section
          variants={staggerContainer}
          initial="hidden"
          animate="show"
          className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:gap-20"
        >
          <div>
            <motion.p variants={fadeUp} className="text-sm font-medium uppercase tracking-[0.2em] text-primary">
              Contact
            </motion.p>
            <motion.h1
              variants={fadeUp}
              className="mt-6 font-serif text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl lg:text-6xl text-balance"
            >
              Tell me about the work you have in mind.
            </motion.h1>
            <motion.p variants={fadeUp} className="mt-6 max-w-md text-lg leading-relaxed text-muted-foreground">
              I usually respond within two working days if the project is a good fit. If you'd rather not use the form, write to me directly at{' '}
              <a
                href="mailto:elena@elenamarchetti.com"
                className="font-medium text-primary underline-offset-4 transition-colors hover:text-primary/80 hover:underline"
              >
                elena@elenamarchetti.com
              </a>
              .
            </motion.p>
            <motion.p variants={fadeUp} className="mt-4 text-sm text-muted-foreground">
              This form is a demonstration; it doesn't send anything.
            </motion.p>
          </div>

          <motion.div variants={fadeUp}>
            {status === 'success' ? (
              <div className="rounded-md bg-card p-8 shadow-sm">
                <h2 className="font-serif text-2xl font-semibold tracking-tight text-foreground">
                  Thank you, {name.split(' ')[0] || 'friend'}.
                </h2>
                <p className="mt-3 text-muted-foreground">
                  Your message has been noted (in this demonstration, nothing is actually sent). I'll be in touch if the project seems like a good match.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="space-y-6 rounded-md bg-card p-6 shadow-sm sm:p-8">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-invalid={errors.name ? true : undefined}
                    aria-describedby={errors.name ? 'name-error' : undefined}
                  />
                  {errors.name && (
                    <p id="name-error" className="text-sm text-destructive">
                      {errors.name}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={errors.email ? true : undefined}
                    aria-describedby={errors.email ? 'email-error' : undefined}
                  />
                  {errors.email && (
                    <p id="email-error" className="text-sm text-destructive">
                      {errors.email}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="message">Message</Label>
                  <Textarea
                    id="message"
                    name="message"
                    rows={5}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    aria-invalid={errors.message ? true : undefined}
                    aria-describedby={errors.message ? 'message-error' : undefined}
                  />
                  {errors.message && (
                    <p id="message-error" className="text-sm text-destructive">
                      {errors.message}
                    </p>
                  )}
                </div>
                <Button type="submit" disabled={status === 'sending'} className="w-full sm:w-auto">
                  {status === 'sending' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      Sending...
                    </>
                  ) : (
                    'Send message'
                  )}
                </Button>
              </form>
            )}
          </motion.div>
        </motion.section>
      </main>
      <SiteFooter />
    </div>
  );
}
