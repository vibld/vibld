import { useState } from 'react';

interface FormState {
  name: string;
  email: string;
  message: string;
}

export function ContactSection() {
  const [form, setForm] = useState<FormState>({ name: '', email: '', message: '' });
  const [errors, setErrors] = useState<Partial<FormState>>({});
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

  const validate = () => {
    const nextErrors: Partial<FormState> = {};
    if (!form.name.trim()) nextErrors.name = 'Name is required.';
    if (!form.email.trim()) {
      nextErrors.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      nextErrors.email = 'Enter a valid email address.';
    }
    if (!form.message.trim()) nextErrors.message = 'Message is required.';
    return nextErrors;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setStatus('sending');
    await new Promise((resolve) => setTimeout(resolve, 800));
    setStatus('sent');
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof FormState]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  return (
    <section id="contact" className="mx-auto max-w-[720px] px-[var(--gutter)] py-[var(--section)]">
      <h2 className="font-display text-[clamp(2.25rem,4vw,3.5rem)] leading-[0.95] tracking-[-0.02em]">
        Contact
      </h2>
      <p className="mt-4 text-base text-muted-foreground">
        Tell me about the project, the dates and the budget you have in mind.
      </p>
      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-6" noValidate>
        <div className="flex flex-col gap-2">
          <label htmlFor="name" className="text-xs font-bold uppercase tracking-[0.08em]">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            value={form.name}
            onChange={handleChange}
            className="w-full border-[3px] border-foreground bg-background px-3 py-2 text-base leading-normal shadow-hard-sm focus:outline-none focus:ring-[3px] focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
            placeholder="Mara Voss"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'name-error' : undefined}
          />
          {errors.name && <p id="name-error" className="text-sm font-bold text-destructive">{errors.name}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="email" className="text-xs font-bold uppercase tracking-[0.08em]">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            className="w-full border-[3px] border-foreground bg-background px-3 py-2 text-base leading-normal shadow-hard-sm focus:outline-none focus:ring-[3px] focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
            placeholder="you@example.com"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'email-error' : undefined}
          />
          {errors.email && <p id="email-error" className="text-sm font-bold text-destructive">{errors.email}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="message" className="text-xs font-bold uppercase tracking-[0.08em]">
            Message
          </label>
          <textarea
            id="message"
            name="message"
            rows={5}
            value={form.message}
            onChange={handleChange}
            className="w-full border-[3px] border-foreground bg-background px-3 py-2 text-base leading-normal shadow-hard-sm focus:outline-none focus:ring-[3px] focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
            placeholder="Project details, dates, budget"
            aria-invalid={Boolean(errors.message)}
            aria-describedby={errors.message ? 'message-error' : undefined}
          />
          {errors.message && <p id="message-error" className="text-sm font-bold text-destructive">{errors.message}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <button type="submit" className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed" disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending...' : 'Send message'}
          </button>
          {status === 'sent' && (
            <p className="font-bold text-secondary" aria-live="polite">
              Message sent (demo).
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            This form is a demonstration and does not send messages yet.
          </p>
        </div>
      </form>
      <div className="mt-10 border-t-[3px] border-foreground pt-6">
        <p className="text-base">
          Prefer email? Write to{' '}
          <a href="mailto:hello@maravoss.com" className="font-bold underline decoration-[3px] underline-offset-4 hover:bg-primary">
            hello@maravoss.com
          </a>
        </p>
      </div>
    </section>
  );
}
