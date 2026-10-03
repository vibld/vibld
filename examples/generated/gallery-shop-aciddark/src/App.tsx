import { MotionConfig } from 'motion/react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { CartProvider } from '@/lib/cart';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import HomePage from '@/pages/Home';
import ProductDetailPage from '@/pages/ProductDetail';

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <CartProvider>
        <BrowserRouter>
          <div className="min-h-screen bg-background text-foreground">
            <SiteHeader />
            <main className="pt-16">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/product/:id" element={<ProductDetailPage />} />
              </Routes>
            </main>
            <SiteFooter />
          </div>
        </BrowserRouter>
      </CartProvider>
    </MotionConfig>
  );
}
