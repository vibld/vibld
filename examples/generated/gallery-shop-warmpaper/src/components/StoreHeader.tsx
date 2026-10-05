import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/cart';
import { ShoppingBag } from 'lucide-react';

export function StoreHeader() {
  const { totalItems, openCart } = useCart();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div>
          <h1 className="text-xl font-serif font-semibold tracking-tight">The Wicksmith</h1>
          <p className="text-xs text-muted-foreground">small-batch candles</p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={openCart}
          aria-label={`Open cart, ${totalItems} items`}
          className="relative h-11 w-11"
        >
          <ShoppingBag className="h-5 w-5" aria-hidden="true" />
          {totalItems > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {totalItems}
            </span>
          )}
        </Button>
      </div>
    </header>
  );
}
