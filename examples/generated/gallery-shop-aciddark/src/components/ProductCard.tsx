import type { Product } from '@/lib/products';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/cart';

export interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  const { addItem } = useCart();

  return (
    <div className="group flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors duration-150 hover:border-muted-foreground">
      <Link
        to={`/product/${product.id}`}
        className="relative block aspect-square w-full overflow-hidden rounded-md bg-gradient-to-br from-muted to-card"
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-display text-2xl font-semibold text-muted-foreground">
            {product.name.split(' ')[0]}
          </span>
        </div>
      </Link>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-lg font-semibold leading-tight text-foreground">
            <Link
              to={`/product/${product.id}`}
              className="transition-colors duration-150 hover:text-primary"
            >
              {product.name}
            </Link>
          </h3>
          <p className="text-sm text-muted-foreground">{product.notes}</p>
        </div>
        <span className="text-sm font-medium text-foreground">${product.price}</span>
      </div>
      <Button onClick={() => addItem(product)} className="w-full">
        Add to cart
      </Button>
    </div>
  );
}
