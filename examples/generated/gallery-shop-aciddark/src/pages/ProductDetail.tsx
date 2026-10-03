import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { products } from '@/lib/products';
import { Button } from '@/components/ui/button';
import { useCart } from '@/lib/cart';

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { addItem } = useCart();
  const product = products.find((p) => p.id === id);

  if (!product) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h1 className="font-display text-2xl font-semibold text-foreground">Product not found</h1>
        <Link
          to="/"
          className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors duration-150 hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to shop
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-24">
      <Link
        to="/"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors duration-150 hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to shop
      </Link>

      <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-12">
        <div className="aspect-square w-full overflow-hidden rounded-md bg-gradient-to-br from-muted to-card">
          <div className="flex h-full items-center justify-center">
            <span className="font-display text-4xl font-semibold text-muted-foreground">
              {product.name.split(' ')[0]}
            </span>
          </div>
        </div>

        <div className="flex flex-col justify-center">
          <h1 className="font-display text-[clamp(2.25rem,5vw,3.75rem)] font-bold leading-[1.0] tracking-[-0.03em] text-foreground">
            {product.name}
          </h1>
          <p className="mt-3 text-lg font-medium text-foreground">${product.price}</p>
          <p className="mt-2 text-base leading-6 text-muted-foreground">{product.notes}</p>
          <Button onClick={() => addItem(product)} className="mt-6 w-full sm:w-auto">
            Add to cart
          </Button>
        </div>
      </div>
    </div>
  );
}
