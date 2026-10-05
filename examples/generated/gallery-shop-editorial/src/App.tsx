import { useEffect, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { CartProvider } from '@/context/CartContext';
import { HomePage } from '@/pages/HomePage';
import { ProductsPage } from '@/pages/ProductsPage';
import { ProductDetailPage } from '@/pages/ProductDetailPage';
import { CartPage } from '@/pages/CartPage';

type Route =
  | { page: 'home' }
  | { page: 'products' }
  | { page: 'cart' }
  | { page: 'product'; id: string };

function getRoute(): Route {
  const hash = window.location.hash;
  if (!hash || hash === '#/' || hash === '') {
    return { page: 'home' };
  }
  if (hash === '#/products') {
    return { page: 'products' };
  }
  if (hash === '#/cart') {
    return { page: 'cart' };
  }
  if (hash.startsWith('#/product/')) {
    const id = hash.slice('#/product/'.length);
    return { page: 'product', id };
  }
  return { page: 'home' };
}

export default function App() {
  const [route, setRoute] = useState<Route>(getRoute);

  useEffect(() => {
    const handleHashChange = () => setRoute(getRoute());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <CartProvider>
        {route.page === 'home' && <HomePage />}
        {route.page === 'products' && <ProductsPage />}
        {route.page === 'cart' && <CartPage />}
        {route.page === 'product' && <ProductDetailPage id={route.id} />}
      </CartProvider>
    </MotionConfig>
  );
}
