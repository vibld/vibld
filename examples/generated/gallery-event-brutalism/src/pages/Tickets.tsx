import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ticketTiers = [
  {
    id: 'day',
    name: 'Day Pass',
    price: 25,
    description: 'One day of access, all food stations, live music. No re-entry.',
  },
  {
    id: 'weekend',
    name: 'Weekend Pass',
    price: 45,
    description: 'Both days, re-entry allowed, 10% off official merchandise.',
  },
  {
    id: 'vip',
    name: 'VIP Pass',
    price: 90,
    description: 'Both days, pit access, one drink token, front-row seat at the fire stage.',
  },
];

export default function Tickets() {
  const [tier, setTier] = useState('day');
  const [quantity, setQuantity] = useState('1');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<{ email?: string; quantity?: string }>({});
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const newErrors: { email?: string; quantity?: string } = {};
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = 'Enter a valid email address.';
    }
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) {
      newErrors.quantity = 'Quantity must be at least 1.';
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      return;
    }
    setStatus('loading');
    window.setTimeout(() => {
      setStatus('success');
    }, 800);
  };

  return (
    <div>
      <section className="border-2 border-foreground bg-secondary p-6 md:p-12 shadow-hard">
        <p className="font-mono text-sm uppercase tracking-widest">Tickets</p>
        <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl uppercase leading-none mt-2">
          Get your pass
        </h1>
        <p className="mt-4 text-lg font-medium max-w-2xl">
          Children under 12 get in free. All passes include access to every food station and the fire stage.
        </p>
      </section>

      <div className="mt-8 grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 grid sm:grid-cols-3 gap-4">
          {ticketTiers.map((t) => (
            <label
              key={t.id}
              className={`border-2 border-foreground p-4 shadow-hard cursor-pointer transition-none ${
                tier === t.id ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'
              }`}
            >
              <input
                type="radio"
                name="tier"
                value={t.id}
                checked={tier === t.id}
                onChange={() => setTier(t.id)}
                className="sr-only"
              />
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-display text-xl uppercase">{t.name}</p>
                  <p className="font-mono text-sm mt-1">${t.price}</p>
                </div>
                <span
                  className={`h-3 w-3 border-2 border-foreground ${
                    tier === t.id ? 'bg-primary-foreground' : 'bg-transparent'
                  }`}
                  aria-hidden="true"
                />
              </div>
              <p className="text-sm mt-2">{t.description}</p>
            </label>
          ))}
        </div>

        <div className="border-2 border-foreground bg-background p-6 shadow-hard">
          <h2 className="font-display text-2xl uppercase mb-4">Order form</h2>
          <form onSubmit={handleSubmit} noValidate>
            <div className="mb-4">
              <Label htmlFor="quantity" className="font-bold uppercase text-sm">
                Quantity
              </Label>
              <Input
                id="quantity"
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="mt-2"
                aria-invalid={!!errors.quantity}
                aria-describedby={errors.quantity ? 'quantity-error' : undefined}
              />
              {errors.quantity && (
                <p id="quantity-error" className="mt-1 text-sm font-bold text-destructive">
                  {errors.quantity}
                </p>
              )}
            </div>
            <div className="mb-6">
              <Label htmlFor="email" className="font-bold uppercase text-sm">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-2"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'email-error' : undefined}
              />
              {errors.email && (
                <p id="email-error" className="mt-1 text-sm font-bold text-destructive">
                  {errors.email}
                </p>
              )}
            </div>
            <Button type="submit" disabled={status === 'loading'} className="w-full">
              {status === 'loading' ? 'Processing...' : 'Reserve tickets'}
            </Button>
            {status === 'success' && (
              <p className="mt-4 text-sm font-bold border-2 border-foreground p-2 bg-primary text-primary-foreground">
                This is a demo, no tickets were issued. Check your email for a confirmation.
              </p>
            )}
          </form>
        </div>
      </div>

      <p className="mt-6 text-sm font-bold text-muted-foreground">
        This form is a demonstration. No payment is processed and no tickets are issued.
      </p>
    </div>
  );
}
