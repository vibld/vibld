import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { ProductCard } from '@/components/ProductCard';
import { products } from '@/lib/products';
import { fade } from '@/lib/motion';
import { cn } from '@/lib/utils';

export default function Home() {
  return (
    <div className="mx-auto max-w-[1200px] px-6">
      <motion.section
        variants={fade}
        initial="hidden"
        animate="show"
        className="py-10 md:py-20"
      >
        <div className="mx-auto max-w-[720px] text-center">
          <h1 className="font-display text-display font-semibold">Candles with calm in mind</h1>
          <p className="mt-4 text-body text-muted-foreground">
            Small-batch, hand-poured candles made with natural wax and essential oils.
          </p>
          <Link to="/#shop" className={cn(buttonVariants(), 'mt-8 inline-flex')}>
            Shop candles
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </motion.section>
      <section id="shop" className="py-10 md:py-20">
        <h2 className="font-display text-h2 font-semibold">Shop the collection</h2>
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>
    </div>
  );
}
