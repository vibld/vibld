import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, Minus, Plus, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { products } from '@/lib/products';
import { useCart } from '@/lib/cart';
import { fade } from '@/lib/motion';

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const product = products.find((p) => p.id === id);
  const { addItem } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  if (!product) {
    return (
      <div className="mx-auto flex max-w-[720px] flex-col items-start gap-4 px-6 py-20">
        <h1 className="font-display text-h1 font-semibold">Candle not found</h1>
        <p className="text-body text-muted-foreground">
          The candle you are looking for may have sold out or the link is incorrect.
        </p>
        <Link
          to="/#shop"
          className="text-sm font-medium text-primary transition-opacity duration-150 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Back to the collection
        </Link>
      </div>
    );
  }

  const handleAddToCart = () => {
    addItem(product.id, quantity);
    setAdded(true);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setAdded(false), 1500);
  };

  const decreaseQuantity = () => {
    setQuantity((prev) => Math.max(1, prev - 1));
  };

  const increaseQuantity = () => {
    setQuantity((prev) => prev + 1);
  };

  return (
    <motion.section
      variants={fade}
      initial="hidden"
      animate="show"
      className="mx-auto max-w-[1000px] px-6 py-10 md:py-20"
    >
      <Link
        to="/#shop"
        className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-opacity duration-150 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to collection
      </Link>

      <div className="grid gap-10 md:grid-cols-2 md:gap-12">
        <div
          className="aspect-[4/5] w-full rounded-sm border border-border"
          style={{ backgroundColor: product.imagePlaceholderColor }}
          role="img"
          aria-label={product.name}
        />
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="font-display text-h1 font-semibold">{product.name}</h1>
            <p className="mt-2 text-body text-muted-foreground">${product.price}</p>
          </div>
          <p className="text-body text-foreground">{product.description}</p>
          <div>
            <span className="text-small font-medium text-muted-foreground">Scent notes</span>
            <ul className="mt-2 flex flex-wrap gap-2">
              {product.scentNotes.map((note) => (
                <li key={note} className="rounded-sm border border-border px-3 py-1 text-small text-foreground">
                  {note}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-2">
            <span className="text-small font-medium text-muted-foreground">Quantity</span>
            <div className="mt-2 flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label="Decrease quantity"
                onClick={decreaseQuantity}
                disabled={quantity <= 1}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span aria-live="polite" className="w-8 text-center text-sm font-medium">
                {quantity}
              </span>
              <Button
                variant="outline"
                size="icon"
                aria-label="Increase quantity"
                onClick={increaseQuantity}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <Button onClick={handleAddToCart} className="w-full md:w-auto" size="lg">
            <ShoppingBag className="h-5 w-5" aria-hidden="true" />
            {added ? 'Added to cart' : 'Add to cart'}
          </Button>
        </div>
      </div>
    </motion.section>
  );
}
