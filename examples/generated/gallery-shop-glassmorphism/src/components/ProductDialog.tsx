import { useState, type ReactNode } from 'react';
import { Flame, Minus, Plus, ShoppingCart } from 'lucide-react';
import type { Product } from '@/lib/types';
import { useCart } from '@/context/CartContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ProductDialogProps {
  product: Product;
  trigger: ReactNode;
}

export default function ProductDialog({
  product,
  trigger,
}: ProductDialogProps) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const { addItem } = useCart();

  const handleAdd = () => {
    addItem(product, quantity);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl tracking-tight">
            {product.name}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {product.description}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2">
          <div
            className="relative aspect-[16/9] w-full overflow-hidden rounded-lg"
            style={{
              background:
                'linear-gradient(135deg, var(--primary), var(--accent))',
            }}
          >
            <Flame
              className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 text-primary-foreground"
              aria-hidden="true"
            />
          </div>
        </div>

        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`quantity-${product.id}`}
              className="text-sm font-medium text-foreground"
            >
              Quantity
            </label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                aria-label="Decrease quantity"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                id={`quantity-${product.id}`}
                type="number"
                min={1}
                value={quantity}
                onChange={(e) =>
                  setQuantity(Math.max(1, Number(e.target.value) || 1))
                }
                className="w-20 text-center"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setQuantity((q) => q + 1)}
                aria-label="Increase quantity"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="text-right">
            <p className="text-sm text-muted-foreground">Price</p>
            <p className="font-display text-2xl text-primary">
              ${(product.price * quantity).toFixed(2)}
            </p>
          </div>
        </div>

        <Button onClick={handleAdd} className="mt-2 w-full">
          <ShoppingCart className="h-4 w-4" aria-hidden="true" />
          Add to cart
        </Button>
      </DialogContent>
    </Dialog>
  );
}
