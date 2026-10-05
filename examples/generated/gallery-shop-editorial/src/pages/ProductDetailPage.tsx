import { useState, type ChangeEvent } from 'react';
import { motion } from 'motion/react';
import { ShoppingCart } from 'lucide-react';
import { SiteLayout } from '@/components/layout/SiteLayout';
import { useCart } from '@/context/CartContext';
import { products } from '@/lib/products';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { fadeInScale, clipWipe } from '@/lib/motion';

interface ProductDetailPageProps {
  id: string;
}

export function ProductDetailPage({ id }: ProductDetailPageProps) {
  const { addItem } = useCart();
  const [quantity, setQuantity] = useState(1);
  const product = products.find((p) => p.id === id);

  if (!product) {
    return (
      <SiteLayout>
        <div className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6 lg:px-8">
          <h1 className="text-3xl font-semibold">Candle not found</h1>
          <p className="mt-4 text-muted-foreground">
            We could not find a candle with that name. It may have sold out.
          </p>
          <Button asChild className="mt-8 cursor-pointer">
            <a href="#/products">Back to all candles</a>
          </Button>
        </div>
      </SiteLayout>
    );
  }

  const handleQuantityChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (Number.isInteger(value) && value > 0 && value <= 99) {
      setQuantity(value);
    }
  };

  const handleAddToCart = () => {
    addItem(product, quantity);
  };

  return (
    <SiteLayout>
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
          <motion.div
            variants={clipWipe}
            initial="hidden"
            animate="show"
            className="overflow-hidden rounded-lg"
          >
            <img
              src={product.image}
              alt={`${product.name} candle`}
              className="aspect-[4/5] w-full object-cover"
            />
          </motion.div>
          <motion.div
            variants={fadeInScale}
            initial="hidden"
            animate="show"
            className="flex flex-col gap-6"
          >
            <div>
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
                {product.name}
              </h1>
              <p className="mt-2 text-2xl text-muted-foreground">${product.price}</p>
            </div>
            <p className="max-w-prose text-lg leading-relaxed text-muted-foreground">
              {product.description}
            </p>
            <div className="flex flex-wrap gap-2">
              {product.notes.map((note) => (
                <Badge key={note} variant="secondary">
                  {note}
                </Badge>
              ))}
            </div>
            <div className="flex items-end gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="quantity" className="text-sm font-medium">
                  Quantity
                </label>
                <Input
                  id="quantity"
                  type="number"
                  min="1"
                  max="99"
                  value={quantity}
                  onChange={handleQuantityChange}
                  className="w-20"
                  aria-label="Quantity"
                />
              </div>
              <Button onClick={handleAddToCart} className="cursor-pointer gap-2">
                <ShoppingCart className="h-4 w-4" aria-hidden="true" />
                Add to cart
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              This store is a demonstration. Your cart stays in your browser and there is no checkout backend.
            </p>
          </motion.div>
        </div>
      </div>
    </SiteLayout>
  );
}
