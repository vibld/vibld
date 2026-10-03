import { useState, type FormEvent, type ChangeEvent } from 'react';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { fadeIn } from '@/lib/motion';

type FormErrors = {
  name?: string;
  email?: string;
  message?: string;
};

export function Contact() {
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const validate = (): FormErrors => {
    const nextErrors: FormErrors = {};
    if (!form.name.trim()) nextErrors.name = 'Please enter your name.';
    if (!form.email.trim()) {
      nextErrors.email = 'Please enter your email address.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      nextErrors.email = 'Please enter a valid email address.';
    }
    if (!form.message.trim()) {
      nextErrors.message = 'Please enter a message.';
    } else if (form.message.trim().length < 10) {
      nextErrors.message = 'Please write at least 10 characters.';
    }
    return nextErrors;
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setStatus('loading');
    window.setTimeout(() => {
      setStatus('success');
      setForm({ name: '', email: '', message: '' });
    }, 800);
  };

  return (
    <section id="contact" className="border-t border-border py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <motion.div
          variants={fadeIn}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          className="grid gap-12 lg:grid-cols-2 lg:gap-24"
        >
          <div>
            <p className="mb-4 text-sm uppercase tracking-[0.2em] text-muted-foreground">
              Get in touch
            </p>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Contact
            </h2>
            <p className="mt-6 text-base leading-relaxed text-muted-foreground">
              Tell us about the decision you are facing. We will reply within two working days.
            </p>
            <p className="mt-8 text-sm text-muted-foreground">
              This form is a demonstration and does not send a message.
            </p>
          </div>
          <div>
            <form onSubmit={handleSubmit} noValidate>
              {status === 'success' && (
                <div
                  role="status"
                  aria-live="polite"
                  className="mb-6 rounded-sm bg-muted px-4 py-3 text-sm text-foreground"
                >
                  Thank you. Your message has been received (demonstration only).
                </div>
              )}
              <div className="mb-6">
                <label htmlFor="name" className="mb-2 block text-sm font-medium text-foreground">
                  Name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  value={form.name}
                  onChange={handleChange}
                  aria-describedby={errors.name ? 'name-error' : undefined}
                  className={`block w-full border-b border-border bg-transparent py-2 text-base text-foreground transition-colors placeholder:text-muted-foreground focus:border-primary focus:outline-none ${errors.name ? 'border-destructive' : ''}`}
                  placeholder="Your full name"
                />
                {errors.name && (
                  <p id="name-error" role="alert" className="mt-2 text-sm text-destructive">
                    {errors.name}
                  </p>
                )}
              </div>
              <div className="mb-6">
                <label htmlFor="email" className="mb-2 block text-sm font-medium text-foreground">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  aria-describedby={errors.email ? 'email-error' : undefined}
                  className={`block w-full border-b border-border bg-transparent py-2 text-base text-foreground transition-colors placeholder:text-muted-foreground focus:border-primary focus:outline-none ${errors.email ? 'border-destructive' : ''}`}
                  placeholder="you@example.com"
                />
                {errors.email && (
                  <p id="email-error" role="alert" className="mt-2 text-sm text-destructive">
                    {errors.email}
                  </p>
                )}
              </div>
              <div className="mb-8">
                <label htmlFor="message" className="mb-2 block text-sm font-medium text-foreground">
                  Message
                </label>
                <textarea
                  id="message"
                  name="message"
                  rows={5}
                  value={form.message}
                  onChange={handleChange}
                  aria-describedby={errors.message ? 'message-error' : undefined}
                  className={`block w-full resize-y border-b border-border bg-transparent py-2 text-base text-foreground transition-colors placeholder:text-muted-foreground focus:border-primary focus:outline-none ${errors.message ? 'border-destructive' : ''}`}
                  placeholder="What are you trying to decide?"
                />
                {errors.message && (
                  <p id="message-error" role="alert" className="mt-2 text-sm text-destructive">
                    {errors.message}
                  </p>
                )}
              </div>
              <button
                type="submit"
                disabled={status === 'loading'}
                className="inline-flex h-12 items-center justify-center rounded-sm bg-primary px-6 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
              >
                {status === 'loading' ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    Sending...
                  </>
                ) : (
                  'Send message'
                )}
              </button>
            </form>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
