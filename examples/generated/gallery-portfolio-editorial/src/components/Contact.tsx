import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { motion } from 'motion/react';
import type { Variants } from 'motion/react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

const contactContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.04,
    },
  },
};

const contactField: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: EASE_OUT },
  },
};

export function Contact() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<{
    name?: string;
    email?: string;
    message?: string;
  }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function handleNameChange(e: ChangeEvent<HTMLInputElement>) {
    setName(e.target.value);
    if (errors.name) {
      setErrors((prev) => ({ ...prev, name: undefined }));
    }
  }

  function handleEmailChange(e: ChangeEvent<HTMLInputElement>) {
    setEmail(e.target.value);
    if (errors.email) {
      setErrors((prev) => ({ ...prev, email: undefined }));
    }
  }

  function handleMessageChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setMessage(e.target.value);
    if (errors.message) {
      setErrors((prev) => ({ ...prev, message: undefined }));
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const nextErrors: typeof errors = {};

    if (!name.trim()) {
      nextErrors.name = 'Please enter your name.';
    }

    if (!email.trim()) {
      nextErrors.email = 'Please enter your email.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      nextErrors.email = 'Please enter a valid email address.';
    }

    if (!message.trim()) {
      nextErrors.message = 'Please write a short message.';
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    setSubmitted(false);

    await new Promise((resolve) => setTimeout(resolve, 900));

    setIsSubmitting(false);
    setSubmitted(true);
  }

  return (
    <section id="contact" className="py-24 md:py-32">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-6 md:grid-cols-2 lg:px-8">
        <div className="space-y-6">
          <h2 className="font-display text-section-title text-foreground">
            Get in touch
          </h2>
          <p className="text-body leading-[1.6] text-muted-foreground">
            Tell me about your project, your timeline, and the look you have in
            mind. This form is a demonstration and does not send messages yet.
          </p>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Prefer email? Write to{' '}
              <a
                href="mailto:hello@lenavoss.photo"
                className="font-medium text-accent underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                hello@lenavoss.photo
              </a>
            </p>
            <p className="text-sm text-muted-foreground">
              Based in Copenhagen, available worldwide.
            </p>
          </div>
        </div>

        <motion.form
          variants={contactContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          className="max-w-[600px] space-y-6"
          onSubmit={handleSubmit}
          noValidate
        >
          <motion.div variants={contactField} className="space-y-2">
            <Label htmlFor="contact-name">Name</Label>
            <Input
              id="contact-name"
              value={name}
              onChange={handleNameChange}
              placeholder="Your name"
              disabled={isSubmitting}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? 'contact-name-error' : undefined}
            />
            {errors.name && (
              <p
                id="contact-name-error"
                className="text-sm text-destructive"
              >
                {errors.name}
              </p>
            )}
          </motion.div>

          <motion.div variants={contactField} className="space-y-2">
            <Label htmlFor="contact-email">Email</Label>
            <Input
              id="contact-email"
              type="email"
              value={email}
              onChange={handleEmailChange}
              placeholder="you@example.com"
              disabled={isSubmitting}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={
                errors.email ? 'contact-email-error' : undefined
              }
            />
            {errors.email && (
              <p
                id="contact-email-error"
                className="text-sm text-destructive"
              >
                {errors.email}
              </p>
            )}
          </motion.div>

          <motion.div variants={contactField} className="space-y-2">
            <Label htmlFor="contact-message">Message</Label>
            <Textarea
              id="contact-message"
              value={message}
              onChange={handleMessageChange}
              placeholder="Tell me about the project, the date, and where it happens."
              disabled={isSubmitting}
              aria-invalid={errors.message ? true : undefined}
              aria-describedby={
                errors.message ? 'contact-message-error' : undefined
              }
            />
            {errors.message && (
              <p
                id="contact-message-error"
                className="text-sm text-destructive"
              >
                {errors.message}
              </p>
            )}
          </motion.div>

          <motion.div variants={contactField}>
            <Button type="submit" disabled={isSubmitting} size="lg">
              {isSubmitting ? 'Sending...' : 'Send message'}
            </Button>
          </motion.div>

          {submitted && (
            <p
              role="status"
              aria-live="polite"
              className="text-sm font-medium text-accent"
            >
              Thanks, your message would be on its way in a real version.
            </p>
          )}
        </motion.form>
      </div>
    </section>
  );
}
