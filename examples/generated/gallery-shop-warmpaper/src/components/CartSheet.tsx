import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/cart';
import { products } from '@/lib/products';
import { Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';

export function CartSheet() {
  const { items, isCartOpen, closeCart, updateQuantity, removeItem, subtotal, totalItems } = useCart();

  return (
    <Sheet open={isCartOpen} onOpenChange={(open) => !open && closeCart()}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Shopping cart</SheetTitle>
          <SheetDescription>
            {totalItems === 0 ? 'Your cart is empty.' : `${totalItems} item${totalItems === 1 ? '' : 's'} in your cart`}
          </SheetDescription>
        </SheetHeader>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <ShoppingBag className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Nothing here yet. Add a candle from the shop.</p>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              <ul className="space-y-4">
                {items.map((item) => {
                  const product = products.find((p) => p.id === item.productId);
                  if (!product) return null;
                  const lineTotal = product.price * item.quantity;
                  return (
                    <li key={item.productId} className="flex gap-4 rounded-lg border border-border bg-card p-3">
                      <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-md ${product.accentClass}`}>
                        <span className="text-xs text-foreground/60">note</span>
                      </div>
                      <div className="flex flex-1 flex-col">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-medium text-foreground">{product.name}</h4>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeItem(item.productId)}
                            aria-label={`Remove ${product.name}`}
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">{product.notes}</p>
                        <div className="mt-auto flex items-center justify-between pt-2">
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                              aria-label={`Decrease quantity of ${product.name}`}
                            >
                              <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                            <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                              aria-label={`Increase quantity of ${product.name}`}
                            >
                              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </div>
                          <span className="text-sm font-medium">${lineTotal.toFixed(2)}</span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Subtotal</span>
                <span className="text-lg font-semibold">${subtotal.toFixed(2)}</span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                This cart lives in your browser. No payment is taken.
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
