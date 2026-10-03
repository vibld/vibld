import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { CartProvider } from '@/lib/cart';
import { SiteHeader } from '@/components/SiteHeader';
import { Footer } from '@/components/Footer';
import Home from '@/pages/Home';
import ProductDetail from '@/pages/ProductDetail';

export default function App() {
  return (
    <BrowserRouter>
      <CartProvider>
        <MotionConfig reducedMotion="user">
          <div className="flex min-h-screen flex-col bg-background text-foreground">
            <SiteHeader />
            <main className="flex-1">
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/product/:id" element={<ProductDetail />} />
              </Routes>
            </main>
            <Footer />
          </div>
        </MotionConfig>
      </CartProvider>
    </BrowserRouter>
  );
}
