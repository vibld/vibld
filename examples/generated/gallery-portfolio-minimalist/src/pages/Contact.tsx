import { motion } from 'motion/react';
import { useState, type FormEvent } from 'react';
import { fadeIn } from '@/lib/motion';

interface FormErrors {
  name?: string;
  email?: string;
  message?: string;
}

const inputClasses =
  'block w-full rounded-[var(--radius-field)] border border-border bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-colors duration-150';

export default function Contact() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState('');

  const validate = (): boolean => {
    const nextErrors: FormErrors = {};
    if (!name.trim()) {
      nextErrors.name = 'Please enter your name.';
    }
    if (!email.trim()) {
      nextErrors.email = 'Please enter your email address.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      nextErrors.email = 'Please enter a valid email address.';
    }
    if (!message.trim()) {
      nextErrors.message = 'Please tell me about your project.';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    setResult('');

    await new Promise((resolve) => setTimeout(resolve, 900));

    setIsSubmitting(false);
    setResult('This form is a demonstration and does not send yet.');
    setName('');
    setEmail('');
    setMessage('');
  };

  return (
    <motion.section
      variants={fadeIn}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.3 }}
      className="max-w-3xl mx-auto px-[var(--gutter)] py-[var(--section-y)]"
    >
      <h1 className="font-display text-[clamp(2.8rem,6vw,4.5rem)] leading-[1.05] tracking-[-0.02em] text-foreground">
        Get in touch
      </h1>
      <p className="mt-6 text-base leading-[1.6] text-muted-foreground max-w-xl">
        Tell me about your project.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-10 space-y-6">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-foreground">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
            }}
            placeholder="Your name"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? 'name-error' : undefined}
            className={`${inputClasses} mt-2`}
          />
          {errors.name && (
            <p id="name-error" className="mt-1 text-sm text-foreground" role="alert">
              {errors.name}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-foreground">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
            }}
            placeholder="you@example.com"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? 'email-error' : undefined}
            className={`${inputClasses} mt-2`}
          />
          {errors.email && (
            <p id="email-error" className="mt-1 text-sm text-foreground" role="alert">
              {errors.email}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="message" className="block text-sm font-medium text-foreground">
            Message
          </label>
          <textarea
            id="message"
            name="message"
            rows={5}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              if (errors.message) setErrors((prev) => ({ ...prev, message: undefined }));
            }}
            placeholder="What are you making?"
            aria-invalid={errors.message ? true : undefined}
            aria-describedby={errors.message ? 'message-error' : undefined}
            className={`${inputClasses} mt-2 resize-y`}
          />
          {errors.message && (
            <p id="message-error" className="mt-1 text-sm text-foreground" role="alert">
              {errors.message}
            </p>
          )}
        </div>

        <div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center px-6 py-3 rounded-[var(--radius-field)] bg-primary text-primary-foreground text-base font-medium hover:bg-primary/90 transition-colors duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Sending...' : 'Send message'}
          </button>
          {result && (
            <p className="mt-4 text-sm text-foreground" role="status">
              {result}
            </p>
          )}
        </div>
      </form>

      <p className="mt-10 text-sm text-muted-foreground">
        This form is a demonstration and does not send yet.
      </p>

      <p className="mt-8 text-base leading-[1.6] text-muted-foreground">
        Or write to{' '}
        <a
          href="mailto:hello@example.com"
          className="text-foreground underline decoration-primary underline-offset-4 hover:opacity-80 transition-opacity duration-150"
        >
          hello@example.com
        </a>
      </p>
    </motion.section>
  );
}
