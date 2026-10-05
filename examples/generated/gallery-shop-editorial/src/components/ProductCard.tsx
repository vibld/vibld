import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCart } from '@/context/CartContext';
import type { Product } from '@/lib/products';

export function ProductCard({ product }: { product: Product }) {
  const { addItem } = useCart();

  return (
    <Card className="overflow-hidden border-0 bg-transparent shadow-none">
      <a
        href={`#/product/${product.id}`}
        className="block overflow-hidden rounded-lg"
        aria-label={`View ${product.name}`}
      >
        <img
          src={product.image}
          alt={`${product.name} candle`}
          loading="lazy"
          className="aspect-[4/5] w-full object-cover"
        />
      </a>
      <CardHeader className="px-0 pt-4 pb-0">
        <CardTitle className="text-xl font-medium tracking-tight">
          <a href={`#/product/${product.id}`} className="hover:underline">
            {product.name}
          </a>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 py-1">
        <p className="text-sm text-muted-foreground">${product.price}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {product.description}
        </p>
      </CardContent>
      <CardFooter className="px-0 pt-3">
        <Button
          className="w-full"
          onClick={() => addItem(product)}
        >
          Add to cart
        </Button>
      </CardFooter>
    </Card>
  );
}
