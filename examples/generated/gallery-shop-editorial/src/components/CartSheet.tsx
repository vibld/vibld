import { ShoppingBag, Trash2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useCart } from '@/context/CartContext';

export function CartSheet() {
  const { items, total, itemCount, updateQuantity, removeItem, clearCart } =
    useCart();

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-full"
          aria-label={`Cart with ${itemCount} item${itemCount === 1 ? '' : 's'}`}
        >
          <ShoppingBag className="h-5 w-5" />
          {itemCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-medium text-primary-foreground">
              {itemCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader className="border-b pb-4">
          <SheetTitle>Your cart</SheetTitle>
          <SheetDescription>
            {itemCount === 0
              ? 'Your cart is empty.'
              : `${itemCount} item${itemCount === 1 ? '' : 's'} selected.`}
          </SheetDescription>
        </SheetHeader>

        {items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">
              No candles in your cart yet.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto py-6">
            <ul className="space-y-6">
              {items.map((item) => (
                <li key={item.product.id} className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-4">
                      <img
                        src={item.product.image}
                        alt={item.product.name}
                        className="h-16 w-16 rounded object-cover"
                      />
                      <div>
                        <p className="font-medium text-foreground">
                          {item.product.name}
                        </p>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          ${item.product.price}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={() => removeItem(item.product.id)}
                      aria-label={`Remove ${item.product.name} from cart`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor={`quantity-${item.product.id}`}
                      className="text-sm text-muted-foreground"
                    >
                      Quantity
                    </label>
                    <Input
                      id={`quantity-${item.product.id}`}
                      type="number"
                      min={1}
                      max={99}
                      value={item.quantity}
                      onChange={(e) => {
                        const qty = Number(e.target.value);
                        if (Number.isFinite(qty) && qty > 0) {
                          updateQuantity(item.product.id, qty);
                        }
                      }}
                      className="h-8 w-20 text-right"
                      aria-label={`Quantity for ${item.product.name}`}
                    />
                  </div>
                  <Separator />
                </li>
              ))}
            </ul>
          </div>
        )}

        {items.length > 0 && (
          <SheetFooter className="flex-col border-t pt-4 sm:flex-col sm:space-x-0">
            <div className="w-full space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  Total
                </span>
                <span className="text-lg font-medium text-foreground">
                  ${total.toFixed(2)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                This cart is for demonstration only. No checkout backend is
                connected, so nothing will be charged.
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={clearCart}>
                  Clear cart
                </Button>
                <Button className="flex-1" disabled>
                  Checkout (demo)
                </Button>
              </div>
            </div>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
