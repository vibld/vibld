import { motion } from 'motion/react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import type { CartItem as CartItemType } from '@/lib/types';
import { useCart } from '@/context/CartContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface CartItemProps {
  item: CartItemType;
}

export default function CartItem({ item }: CartItemProps) {
  const { updateQuantity, removeItem } = useCart();
  const { product } = item;
  const lineTotal = product.price * item.quantity;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--glass)] p-4 shadow-[0_8px_32px_var(--shadow)] backdrop-blur-[18px] sm:flex-row sm:items-center"
    >
      <div
        className="h-16 w-16 shrink-0 rounded-lg"
        style={{ background: product.imageGradient }}
      />

      <div className="min-w-0 flex-1">
        <h3 className="truncate font-medium text-foreground">{product.name}</h3>
        <p className="text-sm text-muted-foreground">${product.price} each</p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={`Decrease quantity of ${product.name}`}
          onClick={() => updateQuantity(product.id, item.quantity - 1)}
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </Button>

        <label className="sr-only" htmlFor={`quantity-${product.id}`}>
          Quantity for {product.name}
        </label>
        <Input
          id={`quantity-${product.id}`}
          type="number"
          min={1}
          value={item.quantity}
          onChange={(e) => {
            const value = Number.parseInt(e.target.value, 10);
            if (!Number.isNaN(value) && value > 0) {
              updateQuantity(product.id, value);
            }
          }}
          className="w-16 text-center"
          aria-label={`Quantity for ${product.name}`}
        />

        <Button
          variant="outline"
          size="icon"
          aria-label={`Increase quantity of ${product.name}`}
          onClick={() => updateQuantity(product.id, item.quantity + 1)}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="w-full text-right font-semibold text-foreground sm:w-20">
        ${lineTotal.toFixed(2)}
      </div>

      <Button
        variant="ghost"
        size="icon"
        aria-label={`Remove ${product.name} from cart`}
        onClick={() => removeItem(product.id)}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    </motion.div>
  );
}
