import { useState } from 'react';
import type { FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CircleAlert, CircleCheck, Info, LoaderCircle, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EASE_OUT } from '@/lib/motion';

type Status = 'idle' | 'sending' | 'done';

type Errors = {
  name?: string;
  phone?: string;
};

type BookingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function BookingDialog({ open, onOpenChange }: BookingDialogProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<Status>('idle');
  const sending = status === 'sending';

  function reset() {
    setName('');
    setPhone('');
    setReason('');
    setErrors({});
    setStatus('idle');
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      window.setTimeout(reset, 320);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Errors = {};
    if (!name.trim()) {
      next.name = 'Please enter your name.';
    }
    if (phone.replace(/\D/g, '').length < 10) {
      next.phone = 'Please enter a phone number we can call, with the area code.';
    }
    setErrors(next);
    if (next.name || next.phone) {
      document.getElementById(next.name ? 'booking-name' : 'booking-phone')?.focus();
      return;
    }
    setStatus('sending');
    // Demonstration only: replace this wait with a request to a real booking system.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1400));
    setStatus('done');
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <p className="sr-only" aria-live="polite">
          {sending ? 'Sending request' : ''}
        </p>
        <AnimatePresence mode="wait" initial={false}>
          {status === 'done' ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT } }}
              exit={{ opacity: 0, y: 12, transition: { duration: 0.28, ease: EASE_OUT } }}
              className="grid justify-items-center gap-4 py-4 text-center"
            >
              <span className="grid size-16 place-items-center rounded-blob bg-accent">
                <CircleCheck aria-hidden="true" className="size-8 text-primary" />
              </span>
              <DialogTitle>Request noted</DialogTitle>
              <DialogDescription className="max-w-sm">
                In the live version, reception would call you back within one working day. Nothing was sent from this
                demonstration.
              </DialogDescription>
              <DialogClose asChild>
                <Button size="lg" className="mt-2">
                  Close
                </Button>
              </DialogClose>
            </motion.div>
          ) : (
            <motion.form
              key="form"
              noValidate
              onSubmit={handleSubmit}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT } }}
              exit={{ opacity: 0, y: 12, transition: { duration: 0.28, ease: EASE_OUT } }}
              className="grid gap-5"
            >
              <DialogHeader>
                <DialogTitle>Request an appointment</DialogTitle>
                <DialogDescription>
                  Tell us who you are and what you need. Reception will call you back to agree a time.
                </DialogDescription>
              </DialogHeader>

              <p className="flex gap-3 rounded-organic-alt bg-muted p-4 text-small text-muted-foreground">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                This form is a demonstration and does not send anything yet. To book today, call 01632 960418.
              </p>

              <div className="grid gap-2">
                <Label htmlFor="booking-name">Full name</Label>
                <Input
                  id="booking-name"
                  name="name"
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-invalid={errors.name ? true : undefined}
                  aria-describedby={errors.name ? 'booking-name-error' : undefined}
                  disabled={sending}
                />
                {errors.name && (
                  <p id="booking-name-error" className="flex items-center gap-2 text-small text-destructive">
                    <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
                    {errors.name}
                  </p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="booking-phone">Phone number</Label>
                <Input
                  id="booking-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  aria-invalid={errors.phone ? true : undefined}
                  aria-describedby={errors.phone ? 'booking-phone-error' : undefined}
                  disabled={sending}
                />
                {errors.phone && (
                  <p id="booking-phone-error" className="flex items-center gap-2 text-small text-destructive">
                    <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
                    {errors.phone}
                  </p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="booking-reason">What is the appointment for? (optional)</Label>
                <Textarea
                  id="booking-reason"
                  name="reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="For example: a check-up, or a filling that has come loose"
                  disabled={sending}
                />
              </div>

              <Button type="submit" size="lg" disabled={sending} className="w-full sm:w-auto sm:justify-self-start">
                {sending ? (
                  <>
                    <LoaderCircle aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />
                    Sending request
                  </>
                ) : (
                  <>
                    <Send aria-hidden="true" className="size-5" />
                    Send request
                  </>
                )}
              </Button>
            </motion.form>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
