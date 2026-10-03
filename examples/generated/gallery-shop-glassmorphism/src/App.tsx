import { useState, useEffect } from 'react';
import { MotionConfig } from 'motion/react';
import { CartProvider } from '@/context/CartContext';
import { SiteLayout } from '@/components/SiteLayout';
import Home from '@/pages/Home';
import Cart from '@/pages/Cart';

export default function App() {
  const getInitialPage = (): 'home' | 'cart' => {
    if (typeof window !== 'undefined' && window.location.pathname === '/cart') {
      return 'cart';
    }
    return 'home';
  };

  const [page, setPage] = useState<'home' | 'cart'>(getInitialPage);

  const navigate = (newPage: 'home' | 'cart') => {
    setPage(newPage);
    const path = newPage === 'cart' ? '/cart' : '/';
    window.history.pushState({ page: newPage }, '', path);
  };

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      setPage(path === '/cart' ? 'cart' : 'home');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleShopClick = () => {
    navigate('home');
  };

  return (
    <MotionConfig reducedMotion="user">
      <CartProvider>
        <SiteLayout
          currentPage={page}
          onNavigate={navigate}
          onShopClick={handleShopClick}
        >
          {page === 'home' ? <Home /> : <Cart />}
        </SiteLayout>
      </CartProvider>
    </MotionConfig>
  );
}
