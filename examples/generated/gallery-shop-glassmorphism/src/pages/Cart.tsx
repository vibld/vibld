import { AnimatePresence } from 'motion/react';
import { useCart } from '@/context/CartContext';
import CartItem from '@/components/CartItem';
import { Button } from '@/components/ui/button';

export default function Cart() {
  const { cart, subtotal } = useCart();

  return (
    <div className="container mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="text-4xl font-bold tracking-tight text-foreground">
        Your cart
      </h1>

      {cart.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--glass)] p-8 text-center shadow-[0_8px_32px_var(--shadow)] backdrop-blur-[18px]">
          <p className="text-lg text-muted-foreground">Your cart is empty.</p>
        </div>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_400px] lg:items-start">
          <div className="flex flex-col gap-4">
            <AnimatePresence initial={false}>
              {cart.map((item) => (
                <CartItem key={item.product.id} item={item} />
              ))}
            </AnimatePresence>
          </div>

          <div className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--glass)] p-6 shadow-[0_8px_32px_var(--shadow)] backdrop-blur-[18px]">
            <h2 className="text-2xl font-semibold text-foreground">Summary</h2>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-semibold text-foreground">
                ${subtotal.toFixed(2)}
              </span>
            </div>
            <Button className="mt-6 w-full" disabled>
              Checkout unavailable
            </Button>
            <p className="mt-4 text-sm text-muted-foreground">
              Your cart is stored locally in your browser. No data leaves your device.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
