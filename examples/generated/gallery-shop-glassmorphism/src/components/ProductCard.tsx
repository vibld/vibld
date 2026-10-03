import { motion, useReducedMotion } from 'motion/react';
import { Flame, ShoppingCart } from 'lucide-react';
import type { Product } from '@/lib/types';
import { useCart } from '@/context/CartContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ProductDialog from '@/components/ProductDialog';
import {
  glassEnter,
  glassEnterReduced,
} from '@/lib/motion';

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  const reduceMotion = useReducedMotion();
  const cardVariants = reduceMotion ? glassEnterReduced : glassEnter;
  const { addItem } = useCart();

  return (
    <motion.article
      variants={cardVariants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.3 }}
      whileHover={{ scale: 1.02 }}
      className="relative flex h-full flex-col rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--glass)] shadow-[0_8px_32px_var(--shadow)] backdrop-blur-[18px]"
    >
      <ProductDialog
        product={product}
        trigger={
          <button
            type="button"
            className="absolute inset-0 z-10 rounded-[var(--radius-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label={`View ${product.name} details`}
          />
        }
      />

      <div className="relative z-0 flex h-full flex-col">
        <div
          className="relative aspect-[4/5] w-full overflow-hidden rounded-t-[var(--radius-card)]"
          style={{
            background:
              'linear-gradient(135deg, var(--primary), var(--accent))',
          }}
        >
          <Flame
            className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 text-primary-foreground"
            aria-hidden="true"
          />
          {product.featured && (
            <Badge className="absolute left-3 top-3 z-20">Bestseller</Badge>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-display text-xl leading-tight text-foreground">
              {product.name}
            </h3>
            <span className="text-lg font-semibold text-primary">
              ${product.price}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {product.description}
          </p>
          <Button
            onClick={() => addItem(product)}
            className="relative z-20 mt-auto w-full"
          >
            <ShoppingCart className="h-4 w-4" aria-hidden="true" />
            Add to cart
          </Button>
        </div>
      </div>
    </motion.article>
  );
}
