import { Trash2, ShoppingCart } from 'lucide-react';
import { SiteLayout } from '@/components/layout/SiteLayout';
import { useCart } from '@/context/CartContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';

export function CartPage() {
  const { items, removeItem, updateQuantity, clearCart, total, itemCount } = useCart();

  if (items.length === 0) {
    return (
      <SiteLayout>
        <div className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6 lg:px-8">
          <ShoppingCart className="mx-auto h-12 w-12 text-muted-foreground" aria-hidden="true" />
          <h1 className="mt-6 text-3xl font-semibold">Your cart is empty</h1>
          <p className="mt-4 text-muted-foreground">
            There is nothing here yet. Browse the candles and find something that smells like home.
          </p>
          <Button asChild className="mt-8 cursor-pointer">
            <a href="#/products">Shop all candles</a>
          </Button>
        </div>
      </SiteLayout>
    );
  }

  return (
    <SiteLayout>
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <header className="mb-10">
          <h1 className="text-4xl font-semibold tracking-tight">Your cart</h1>
          <p className="mt-2 text-muted-foreground">
            {itemCount} item{itemCount === 1 ? '' : 's'} in your cart.
          </p>
        </header>

        <div className="space-y-6">
          {items.map((item) => (
            <div key={item.product.id} className="flex items-center gap-6 rounded-lg border border-border p-4 sm:p-6">
              <img
                src={item.product.image}
                alt={`${item.product.name} candle`}
                className="h-24 w-24 rounded-md object-cover"
              />
              <div className="flex flex-1 flex-col gap-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <a href={`#/product/${item.product.id}`} className="text-lg font-medium hover:underline">
                      {item.product.name}
                    </a>
                    <p className="text-sm text-muted-foreground">${item.product.price}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.product.id)}
                    className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    aria-label={`Remove ${item.product.name} from cart`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor={`quantity-${item.product.id}`} className="sr-only">
                    Quantity for {item.product.name}
                  </label>
                  <Input
                    id={`quantity-${item.product.id}`}
                    type="number"
                    min="1"
                    max="99"
                    value={item.quantity}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (Number.isInteger(value) && value > 0) {
                        updateQuantity(item.product.id, value);
                      }
                    }}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">
                    ${(item.product.price * item.quantity).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <Separator className="my-8" />

        <div className="flex flex-col items-end gap-4">
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Total</p>
            <p className="text-3xl font-semibold">${total.toFixed(2)}</p>
          </div>
          <div className="flex gap-4">
            <Button variant="ghost" onClick={clearCart} className="cursor-pointer">
              Clear cart
            </Button>
            <Button disabled className="cursor-not-allowed">
              Checkout
            </Button>
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            This is a demonstration store. There is no checkout backend, so the cart stays in your browser and orders cannot be placed.
          </p>
        </div>
      </div>
    </SiteLayout>
  );
}
