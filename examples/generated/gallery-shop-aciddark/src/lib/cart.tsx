import { createContext, useContext, useState, useEffect, useMemo, type ReactNode } from 'react';
import { products } from './products';
import type { Product } from './products';

export interface CartLine {
  product: Product;
  quantity: number;
}

interface CartContextValue {
  cart: CartLine[];
  addItem: (product: Product) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  totalCount: number;
  totalPrice: number;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);
const STORAGE_KEY = 'acid-wick-cart';

function loadCart(): CartLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const lines: CartLine[] = [];
    for (const item of parsed) {
      if (typeof item?.id !== 'string' || typeof item?.quantity !== 'number') continue;
      const product = products.find(p => p.id === item.id);
      if (!product) continue;
      lines.push({ product, quantity: Math.max(1, Math.floor(item.quantity)) });
    }
    return lines;
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartLine[]>(loadCart);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cart.map(line => ({ id: line.product.id, quantity: line.quantity }))));
    } catch {}
  }, [cart]);

  const addItem = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(line => line.product.id === product.id);
      if (existing) {
        return prev.map(line => line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line);
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeItem = (productId: string) => {
    setCart(prev => prev.filter(line => line.product.id !== productId));
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(productId);
      return;
    }
    setCart(prev => prev.map(line => line.product.id === productId ? { ...line, quantity: Math.floor(quantity) } : line));
  };

  const clearCart = () => setCart([]);

  const totalCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const totalPrice = cart.reduce((sum, line) => sum + line.product.price * line.quantity, 0);

  const value = useMemo(() => ({ cart, addItem, removeItem, updateQuantity, clearCart, totalCount, totalPrice }), [cart, totalCount, totalPrice]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
