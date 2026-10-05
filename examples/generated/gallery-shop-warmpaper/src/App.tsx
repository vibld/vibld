import { MotionConfig } from 'motion/react';
import { CartProvider } from '@/lib/cart';
import Storefront from '@/pages/Storefront';

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <CartProvider>
        <Storefront />
      </CartProvider>
    </MotionConfig>
  );
}
