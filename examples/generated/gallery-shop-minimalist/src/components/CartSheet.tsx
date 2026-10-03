import { Link } from 'react-router-dom';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useCart } from '@/lib/cart';
import { products } from '@/lib/products';

export function CartSheet() {
  const { items, removeItem, updateQuantity, itemCount } = useCart();

  const cartItems = items.flatMap((item) => {
    const product = products.find((p) => p.id === item.productId);
    return product ? [{ product, quantity: item.quantity }] : [];
  });

  const total = cartItems.reduce(
    (sum, { product, quantity }) => sum + product.price * quantity,
    0
  );

  return (
    <SheetContent className="flex w-full max-w-md flex-col p-0">
      <SheetHeader className="border-b border-border p-6">
        <SheetTitle>Your cart</SheetTitle>
        <SheetDescription>
          {itemCount === 0
            ? 'Your cart is empty.'
            : `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto p-6">
        {cartItems.length === 0 ? (
          <div className="flex flex-col items-start gap-4 py-8">
            <p className="text-body text-muted-foreground">
              Nothing here yet. Take a look at the collection.
            </p>
            <Link
              to="/#shop"
              className="text-sm font-medium text-primary transition-opacity duration-150 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Shop candles
            </Link>
          </div>
        ) : (
          <ul className="space-y-6">
            {cartItems.map(({ product, quantity }) => (
              <li
                key={product.id}
                className="flex items-start justify-between gap-4 border-b border-border pb-6 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-display text-base font-semibold text-foreground">
                    {product.name}
                  </p>
                  <p className="text-small text-muted-foreground">${product.price} each</p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-11 w-11"
                      aria-label={`Decrease quantity of ${product.name}`}
                      onClick={() => updateQuantity(product.id, quantity - 1)}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="w-8 text-center text-sm font-medium">{quantity}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-11 w-11"
                      aria-label={`Increase quantity of ${product.name}`}
                      onClick={() => updateQuantity(product.id, quantity + 1)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-3">
                  <p className="text-sm font-medium text-foreground">${product.price * quantity}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${product.name}`}
                    onClick={() => removeItem(product.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {cartItems.length > 0 && (
        <SheetFooter className="border-t border-border p-6">
          <div className="flex w-full flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="font-display text-base font-semibold text-foreground">${total}</span>
            </div>
            <Button className="w-full">Checkout</Button>
            <p className="text-small text-muted-foreground">
              This is a demonstration cart. No order will be placed.
            </p>
          </div>
        </SheetFooter>
      )}
    </SheetContent>
  );
}
