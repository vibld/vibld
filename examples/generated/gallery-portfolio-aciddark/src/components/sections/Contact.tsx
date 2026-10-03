import { useState, type FormEvent } from 'react';
import { MotionConfig, motion } from 'motion/react';
import { Loader2 } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { buttonPress } from '@/lib/motion';

export function Contact() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setSubmitted(true);
      setName('');
      setEmail('');
      setMessage('');
    }, 800);
  };

  return (
    <MotionConfig reducedMotion="user">
      <section id="contact" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[600px]">
          <h2 className="type-heading font-semibold text-foreground">Get in touch</h2>
          <p className="type-body mt-4 text-muted-foreground">
            Have a project in mind? Fill out the form or email me directly.
          </p>
          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="message">Message</Label>
              <Textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tell me about your project"
                required
                disabled={loading}
              />
            </div>
            <motion.button
              type="submit"
              className={buttonVariants({ variant: 'default', size: 'lg', className: 'w-full sm:w-auto' })}
              variants={buttonPress}
              whileTap="pressed"
              disabled={loading}
            >
              {loading ? <Loader2 className="animate-spin" /> : 'Send message'}
            </motion.button>
          </form>
          {submitted && (
            <p role="status" className="type-small mt-4 text-primary">
              Message sent (demonstration). I'll get back to you soon.
            </p>
          )}
          <p className="type-small mt-4 text-muted-foreground">
            Prefer email?{' '}
            <a
              href="mailto:hello@alexmorgan.photo"
              className="text-primary underline-offset-4 hover:underline"
            >
              hello@alexmorgan.photo
            </a>
          </p>
          <p className="type-caption mt-6 text-muted-foreground">
            This form is a demonstration and does not send.
          </p>
        </div>
      </section>
    </MotionConfig>
  );
}
