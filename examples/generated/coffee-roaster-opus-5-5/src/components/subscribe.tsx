import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, CircleAlert, CircleCheck, Info, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { coffees } from '@/lib/coffees';
import { easePaper, reveal, spring, viewportOnce } from '@/lib/motion';

type Status = 'idle' | 'loading' | 'done';
type FieldErrors = { email?: string; grind?: string };
type Option = { value: string; label: string };

const coffeeOptions: Option[] = [
  { value: 'roasters-choice', label: "Roaster's choice, changes monthly" },
  ...coffees.map((coffee) => ({ value: coffee.id, label: `${coffee.name}, ${coffee.country}` })),
];

const grindOptions: Option[] = [
  { value: 'whole-bean', label: 'Whole bean' },
  { value: 'espresso', label: 'Espresso' },
  { value: 'moka', label: 'Moka pot' },
  { value: 'pour-over', label: 'Pour-over' },
  { value: 'aeropress', label: 'AeroPress' },
  { value: 'french-press', label: 'French press' },
];

const frequencyOptions: Option[] = [
  { value: '2', label: 'Every two weeks' },
  { value: '4', label: 'Every four weeks' },
];

const perks = [
  'Roast date printed on every label',
  'Ground to order for your brewer',
  'No account and no minimum number of bags',
];

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function labelFor(options: Option[], value: string) {
  return options.find((option) => option.value === value)?.label ?? '';
}

function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="flex items-center gap-2 text-base text-destructive">
      <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
      {children}
    </p>
  );
}

export function Subscribe() {
  const [email, setEmail] = useState('');
  const [coffee, setCoffee] = useState('roasters-choice');
  const [grind, setGrind] = useState('');
  const [frequency, setFrequency] = useState('2');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>('idle');
  const emailRef = useRef<HTMLInputElement>(null);
  const grindRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const loading = status === 'loading';

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    const next: FieldErrors = {};
    if (!emailPattern.test(email.trim())) next.email = 'Enter an email address, like name@example.com.';
    if (!grind) next.grind = 'Choose how you brew so we can grind for it.';
    setErrors(next);

    if (next.email) {
      emailRef.current?.focus();
      return;
    }
    if (next.grind) {
      grindRef.current?.focus();
      return;
    }

    setStatus('loading');
    // Demonstration only: nothing is sent. Replace this timeout with a call to your checkout.
    timer.current = window.setTimeout(() => setStatus('done'), 1200);
  }

  function handleReset() {
    setEmail('');
    setCoffee('roasters-choice');
    setGrind('');
    setFrequency('2');
    setErrors({});
    setStatus('idle');
  }

  return (
    <section id="subscribe" aria-labelledby="subscribe-heading" className="bg-muted">
      <div className="mx-auto grid max-w-page items-start gap-12 px-5 py-24 md:px-10 md:py-36 lg:grid-cols-12 lg:gap-x-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={reveal}
          className="lg:col-span-5 lg:pt-4"
        >
          <p className="text-label font-semibold uppercase text-muted-foreground">Subscribe</p>
          <h2 id="subscribe-heading" className="mt-4 text-headline font-semibold">
            One bag, every two or four weeks.
          </h2>
          <p className="mt-6 max-w-measure text-body text-muted-foreground">
            $19 per 340 g bag with US shipping included. Two days before each roast you get an email with links to skip, swap or cancel.
          </p>
          <ul className="mt-8 grid gap-3">
            {perks.map((perk) => (
              <li key={perk} className="flex items-start gap-3 text-body">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-pill bg-accent text-accent-foreground">
                  <Check className="size-4" aria-hidden="true" />
                </span>
                {perk}
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={viewportOnce}
          transition={reveal}
          className="rounded-lg border border-border bg-card p-6 text-card-foreground shadow-medium sm:p-10 lg:col-span-6 lg:col-start-7"
        >
          <p className="sr-only" aria-live="polite">
            {status === 'loading' ? 'Checking your details' : status === 'done' ? 'Demo complete: nothing was sent.' : ''}
          </p>

          <AnimatePresence mode="wait" initial={false}>
            {status === 'done' ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12, transition: { duration: 0.23, ease: easePaper } }}
                transition={reveal}
              >
                <CircleCheck className="size-8 text-accent" aria-hidden="true" />
                <h3 className="mt-4 text-title font-semibold">Demo complete: nothing was sent.</h3>
                <dl className="mt-6 grid gap-3 border-y border-border py-5 text-base">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Coffee</dt>
                    <dd className="text-right font-semibold">{labelFor(coffeeOptions, coffee)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Grind</dt>
                    <dd className="text-right font-semibold">{labelFor(grindOptions, grind)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">How often</dt>
                    <dd className="text-right font-semibold">{labelFor(frequencyOptions, frequency)}</dd>
                  </div>
                </dl>
                <p className="mt-5 text-base text-muted-foreground">
                  On the live site this step would open checkout. Your email was not stored.
                </p>
                <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} transition={spring} className="mt-8 inline-flex">
                  <Button type="button" variant="outline" onClick={handleReset}>
                    Start over
                  </Button>
                </motion.div>
              </motion.div>
            ) : (
              <motion.form
                key="form"
                noValidate
                onSubmit={handleSubmit}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12, transition: { duration: 0.23, ease: easePaper } }}
                transition={reveal}
              >
                <h3 className="text-title font-semibold">Your first bag</h3>

                <div className="mt-8 grid gap-6">
                  <div className="grid gap-2">
                    <Label htmlFor="email">Email address</Label>
                    <Input
                      ref={emailRef}
                      id="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      disabled={loading}
                      aria-invalid={errors.email ? true : undefined}
                      aria-describedby={errors.email ? 'email-error' : undefined}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
                      }}
                    />
                    {errors.email ? <FieldError id="email-error">{errors.email}</FieldError> : null}
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="coffee">Coffee</Label>
                    <Select value={coffee} onValueChange={setCoffee} disabled={loading}>
                      <SelectTrigger id="coffee">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {coffeeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-6 sm:grid-cols-2">
                    <div className="grid content-start gap-2">
                      <Label htmlFor="grind">Grind</Label>
                      <Select
                        value={grind}
                        disabled={loading}
                        onValueChange={(value) => {
                          setGrind(value);
                          if (errors.grind) setErrors((prev) => ({ ...prev, grind: undefined }));
                        }}
                      >
                        <SelectTrigger
                          ref={grindRef}
                          id="grind"
                          aria-invalid={errors.grind ? true : undefined}
                          aria-describedby={errors.grind ? 'grind-error' : undefined}
                        >
                          <SelectValue placeholder="Choose how you brew" />
                        </SelectTrigger>
                        <SelectContent>
                          {grindOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors.grind ? <FieldError id="grind-error">{errors.grind}</FieldError> : null}
                    </div>

                    <div className="grid content-start gap-2">
                      <Label htmlFor="frequency">How often</Label>
                      <Select value={frequency} onValueChange={setFrequency} disabled={loading}>
                        <SelectTrigger id="frequency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {frequencyOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} transition={spring} className="mt-8">
                  <Button type="submit" size="lg" className="w-full" disabled={loading}>
                    {loading ? (
                      <>
                        <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        Checking your details
                      </>
                    ) : (
                      'Start a subscription'
                    )}
                  </Button>
                </motion.div>

                <p className="mt-5 flex items-start gap-2 text-base text-muted-foreground">
                  <Info className="mt-1 size-4 shrink-0" aria-hidden="true" />
                  This form is a demonstration. It doesn't send anything or take payment yet.
                </p>
              </motion.form>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </section>
  );
}
