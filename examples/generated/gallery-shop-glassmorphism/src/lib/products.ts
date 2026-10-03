import type { Product } from './types';

export const products: Product[] = [
  {
    id: 'amber-glow',
    name: 'Amber Glow',
    price: 18,
    description: 'Warm amber and vanilla, like a sunset.',
    featured: true,
    imageGradient: 'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)',
  },
  {
    id: 'cedar-sage',
    name: 'Cedar & Sage',
    price: 20,
    description: 'Woodsy and clean, for focus.',
    featured: true,
    imageGradient: 'linear-gradient(135deg, #2d6a4f 0%, #1b4332 100%)',
  },
  {
    id: 'lavender-dusk',
    name: 'Lavender Dusk',
    price: 19,
    description: 'Calming lavender with a hint of musk.',
    featured: true,
    imageGradient: 'linear-gradient(135deg, #9d4edd 0%, #5a189a 100%)',
  },
  {
    id: 'sea-salt-driftwood',
    name: 'Sea Salt & Driftwood',
    price: 22,
    description: 'Fresh ocean breeze with a woody base.',
    featured: false,
    imageGradient: 'linear-gradient(135deg, #48cae4 0%, #023e8a 100%)',
  },
  {
    id: 'fig-honey',
    name: 'Fig & Honey',
    price: 21,
    description: 'Sweet fig with a touch of golden honey.',
    featured: false,
    imageGradient: 'linear-gradient(135deg, #ffafcc 0%, #ffc8dd 100%)',
  },
  {
    id: 'pumpkin-spice',
    name: 'Pumpkin Spice',
    price: 18,
    description: 'Classic autumn spices, cozy and warm.',
    featured: false,
    imageGradient: 'linear-gradient(135deg, #e76f51 0%, #d00000 100%)',
  },
];
