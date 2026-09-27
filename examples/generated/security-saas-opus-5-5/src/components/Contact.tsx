import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CircleAlert, CircleCheck, Info, LoaderCircle, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Reveal } from '@/components/Reveal';
import { easeOut } from '@/lib/motion';
import type { PlanSelection } from '@/types';

type Field = 'name' | 'email' | 'company' | 'message';
type Values = Record<Field, string>;
type Errors = Partial<Record<Field, string>>;
type Status = 'idle' | 'submitting' | 'sent';

const emptyValues: Values = { name: '', email: '', company: '', message: '' };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validate(values: Values): Errors {
  const errors: Errors = {};
  if (!values.name.trim()) {
    errors.name = 'Enter your name.';
  }
  if (!values.email.trim()) {
    errors.email = 'Enter your work email.';
  } else if (!emailPattern.test(values.email.trim())) {
    errors.email = 'That email looks incomplete. Use the form name@company.com.';
  }
  if (values.message.trim().length < 20) {
    errors.message = 'Add a little more detail, at least 20 characters.';
  }
  return errors;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-2 flex items-start gap-1.5 text-small text-destructive">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

type ContactProps = {
  selectedPlan: PlanSelection | null;
  onClearPlan: () => void;
};

export function Contact({ selectedPlan, onClearPlan }: ContactProps) {
  const [values, setValues] = useState<Values>(emptyValues);
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<Status>('idle');

  function update(field: Field, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
    if (errors[field]) {
      setErrors((previous) => ({ ...previous, [field]: undefined }));
    }
  }

  async function handleSubmit() {
    const next = validate(values);
    setErrors(next);
    const firstInvalid = (Object.keys(next) as Field[])[0];
    if (firstInvalid) {
      document.getElementById(`contact-${firstInvalid}`)?.focus();
      return;
    }
    setStatus('submitting');
    // Demonstration only: replace this wait with a request to your own endpoint.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 900));
    setStatus('sent');
  }

  function reset() {
    setValues(emptyValues);
    setErrors({});
    setStatus('idle');
    onClearPlan();
  }

  const submitting = status === 'submitting';

  return (
    <section id="contact" className="border-t border-border py-24 lg:py-32">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-12 lg:gap-16">
        <Reveal className="lg:col-span-5">
          <p className="font-display text-label font-semibold uppercase text-muted-foreground">Contact</p>
          <h2 className="mt-4 font-display text-title font-bold text-foreground">Tell us what you need to protect.</h2>
          <p className="mt-5 text-lead text-muted-foreground">
            Scope questions, a vendor security review, or a plan that does not fit: the engineers who build the
            scanner read these messages and reply within one working day.
          </p>
          <dl className="mt-10 space-y-5">
            <div>
              <dt className="font-display text-label font-semibold uppercase text-muted-foreground">Email</dt>
              <dd className="mt-1 text-foreground">hello@tripline.example</dd>
            </div>
            <div>
              <dt className="font-display text-label font-semibold uppercase text-muted-foreground">
                Vulnerability reports
              </dt>
              <dd className="mt-1 text-foreground">security@tripline.example</dd>
            </div>
          </dl>
        </Reveal>

        <div className="lg:col-span-7">
          <AnimatePresence mode="wait" initial={false}>
            {status !== 'sent' ? (
              <motion.form
                key="form"
                noValidate
                aria-label="Contact form"
                aria-describedby="contact-demo-note"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSubmit();
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                transition={{ duration: 0.15 }}
                className="rounded-lg border border-border bg-card p-6 text-card-foreground sm:p-8"
              >
                {selectedPlan && (
                  <div className="mb-6 flex items-center justify-between gap-2 rounded-md border border-border bg-background pl-4">
                    <p className="text-small font-medium">
                      About: {selectedPlan.plan} plan, billed{' '}
                      {selectedPlan.billing === 'annual' ? 'annually' : 'monthly'}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove plan from message"
                      onClick={onClearPlan}
                    >
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                )}

                <div className="grid gap-6 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="contact-name">Name</Label>
                    <Input
                      id="contact-name"
                      name="name"
                      autoComplete="name"
                      placeholder="Jordan Lee"
                      className="mt-2"
                      value={values.name}
                      onChange={(event) => update('name', event.target.value)}
                      aria-invalid={errors.name ? true : undefined}
                      aria-describedby={errors.name ? 'contact-name-error' : undefined}
                      disabled={submitting}
                    />
                    <FieldError id="contact-name-error" message={errors.name} />
                  </div>
                  <div>
                    <Label htmlFor="contact-email">Work email</Label>
                    <Input
                      id="contact-email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      placeholder="jordan@company.com"
                      className="mt-2"
                      value={values.email}
                      onChange={(event) => update('email', event.target.value)}
                      aria-invalid={errors.email ? true : undefined}
                      aria-describedby={errors.email ? 'contact-email-error' : undefined}
                      disabled={submitting}
                    />
                    <FieldError id="contact-email-error" message={errors.email} />
                  </div>
                </div>

                <div className="mt-6">
                  <Label htmlFor="contact-company">
                    Company <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="contact-company"
                    name="company"
                    autoComplete="organization"
                    placeholder="Company name"
                    className="mt-2"
                    value={values.company}
                    onChange={(event) => update('company', event.target.value)}
                    disabled={submitting}
                  />
                </div>

                <div className="mt-6">
                  <Label htmlFor="contact-message">Message</Label>
                  <Textarea
                    id="contact-message"
                    name="message"
                    rows={5}
                    placeholder="We have about 80 public hosts across AWS and an older data centre, and want to know what is exposed."
                    className="mt-2"
                    value={values.message}
                    onChange={(event) => update('message', event.target.value)}
                    aria-invalid={errors.message ? true : undefined}
                    aria-describedby={errors.message ? 'contact-message-error' : undefined}
                    disabled={submitting}
                  />
                  <FieldError id="contact-message-error" message={errors.message} />
                </div>

                <p id="contact-demo-note" className="mt-6 flex items-start gap-2 text-small text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  This form is a demonstration. Nothing is sent, and nothing you type leaves your browser.
                </p>

                <Button type="submit" variant="inverse" size="lg" className="mt-6 w-full sm:w-auto" disabled={submitting}>
                  {submitting ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      Sending
                    </>
                  ) : (
                    <>
                      Send message
                      <Send className="size-4" aria-hidden="true" />
                    </>
                  )}
                </Button>
                <p aria-live="polite" className="sr-only">
                  {submitting ? 'Sending your message' : ''}
                </p>
              </motion.form>
            ) : (
              <motion.div
                key="sent"
                role="status"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: easeOut }}
                className="relative rounded-lg border border-border bg-card p-6 text-card-foreground sm:p-8"
              >
                <motion.span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-lg border-2 border-primary"
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 0.5, ease: easeOut }}
                />
                <CircleCheck className="size-8 text-foreground" aria-hidden="true" />
                <h3 className="mt-4 font-display text-heading font-semibold">Message checked and ready</h3>
                <p className="mt-3 text-muted-foreground">
                  This demo stops here and sends nothing. On the live site, a reply would go to the address you
                  entered within one working day.
                </p>
                <Button variant="secondary" className="mt-6" onClick={reset}>
                  Write another message
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
