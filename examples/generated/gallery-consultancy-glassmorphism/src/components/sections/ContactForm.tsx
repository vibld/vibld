import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { fadeUp, staggerContainer, glassIn } from '@/lib/motion';

type ContactFormState = {
  name: string;
  email: string;
  company: string;
  message: string;
};

const initialForm: ContactFormState = {
  name: '',
  email: '',
  company: '',
  message: '',
};

type FormErrors = Partial<Record<keyof ContactFormState, string>>;

export function ContactForm() {
  const [form, setForm] = useState<ContactFormState>(initialForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');

  const updateField = (field: keyof ContactFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: FormErrors = {};

    if (!form.name.trim()) nextErrors.name = 'Name is required.';
    if (!form.email.trim()) {
      nextErrors.email = 'Email is required.';
    } else if (!/\S+@\S+\.\S+/.test(form.email)) {
      nextErrors.email = 'Enter a valid email address.';
    }
    if (!form.message.trim()) nextErrors.message = 'Message is required.';

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setStatus('loading');
    await new Promise((resolve) => setTimeout(resolve, 1400));
    setStatus('success');
    setForm(initialForm);
    setErrors({});
  };

  return (
    <section id="contact" className="bg-background px-5 py-20 sm:px-8 lg:py-28">
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.2 }}
        className="mx-auto max-w-6xl"
      >
        <motion.p variants={fadeUp} className="text-sm font-medium uppercase tracking-[0.2em] text-primary">
          Contact
        </motion.p>
        <motion.h2
          variants={fadeUp}
          className="mt-4 max-w-3xl font-display text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl"
        >
          Start a conversation
        </motion.h2>
        <motion.p
          variants={fadeUp}
          className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground"
        >
          Tell us what you are facing. We reply within two business days and start with a plain-language read on the problem.
        </motion.p>

        <motion.div
          variants={glassIn}
          className="mt-12 rounded-3xl border border-white/10 bg-white/10 p-6 shadow-2xl shadow-black/20 backdrop-blur-xl md:p-10"
        >
          <form onSubmit={handleSubmit} className="space-y-6" noValidate>
            {status === 'success' && (
              <div
                className="rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm text-primary"
                role="status"
              >
                <CheckCircle2 className="mr-2 inline size-4" aria-hidden />
                This is a demonstration. Nothing was sent or stored, but the form behavior is ready to wire to a real inbox.
              </div>
            )}

            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  placeholder="Your full name"
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? 'name-error' : undefined}
                  autoComplete="name"
                />
                {errors.name && (
                  <p id="name-error" className="text-sm text-red-400" role="alert">
                    {errors.name}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  placeholder="you@company.com"
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? 'email-error' : undefined}
                  autoComplete="email"
                />
                {errors.email && (
                  <p id="email-error" className="text-sm text-red-400" role="alert">
                    {errors.email}
                  </p>
                )}
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="company">
                  Company <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="company"
                  value={form.company}
                  onChange={(e) => updateField('company', e.target.value)}
                  placeholder="Company or organization"
                  autoComplete="organization"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="message">Message</Label>
                <Textarea
                  id="message"
                  value={form.message}
                  onChange={(e) => updateField('message', e.target.value)}
                  placeholder="A short note about the decision or problem on your desk."
                  aria-invalid={Boolean(errors.message)}
                  aria-describedby={errors.message ? 'message-error' : undefined}
                />
                {errors.message && (
                  <p id="message-error" className="text-sm text-red-400" role="alert">
                    {errors.message}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-4 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-relaxed text-muted-foreground">
                This form is a demonstration. No data leaves your browser.
              </p>
              <Button type="submit" size="lg" disabled={status === 'loading'}>
                {status === 'loading' ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    Sending...
                  </>
                ) : status === 'success' ? (
                  <>
                    <CheckCircle2 className="size-4" aria-hidden />
                    Demo complete
                  </>
                ) : (
                  <>
                    Send message
                    <ArrowRight className="size-4" aria-hidden />
                  </>
                )}
              </Button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </section>
  );
}
