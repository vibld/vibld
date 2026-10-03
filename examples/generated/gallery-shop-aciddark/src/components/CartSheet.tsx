import {
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/cart';
import { Minus, Plus, Trash2, ShoppingCart } from 'lucide-react';

export default function CartSheet() {
  const { cart, removeItem, updateQuantity, clearCart, totalCount, totalPrice } = useCart();

  return (
    <SheetContent side="right" className="flex flex-col">
      <SheetHeader>
        <SheetTitle>Your cart</SheetTitle>
        <SheetDescription>
          {totalCount} item{totalCount !== 1 ? 's' : ''}
        </SheetDescription>
      </SheetHeader>
      {cart.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <ShoppingCart className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Your cart is empty.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6">
          <ul className="space-y-4">
            {cart.map((line) => (
              <li
                key={line.product.id}
                className="flex items-center gap-4 border-b border-border pb-4"
              >
                <div
                  className="h-16 w-16 shrink-0 rounded-md bg-gradient-to-br from-muted to-card"
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0">
                  <h4 className="truncate font-display text-base font-semibold text-foreground">
                    {line.product.name}
                  </h4>
                  <p className="text-sm text-muted-foreground">${line.product.price}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => updateQuantity(line.product.id, line.quantity - 1)}
                    aria-label={`Decrease quantity of ${line.product.name}`}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="w-8 text-center text-sm font-medium text-foreground">
                    {line.quantity}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => updateQuantity(line.product.id, line.quantity + 1)}
                    aria-label={`Increase quantity of ${line.product.name}`}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => removeItem(line.product.id)}
                  aria-label={`Remove ${line.product.name} from cart`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <SheetFooter className="flex w-full flex-col gap-4 border-t border-border p-6">
        <div className="flex w-full items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">Total</span>
          <span className="font-display text-lg font-semibold text-foreground">
            ${totalPrice.toFixed(2)}
          </span>
        </div>
        <Button
          variant="secondary"
          className="w-full"
          onClick={clearCart}
          disabled={cart.length === 0}
        >
          Clear cart
        </Button>
        <p className="text-xs text-muted-foreground">
          Demo cart, keeps items in your browser. No checkout.
        </p>
      </SheetFooter>
    </SheetContent>
  );
}
