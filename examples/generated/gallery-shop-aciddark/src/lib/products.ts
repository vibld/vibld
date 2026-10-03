export interface Product {
  id: string;
  name: string;
  price: number;
  notes: string;
  slug: string;
}

export const products: Product[] = [
  { id: '1', name: 'Night Shift', price: 28, notes: 'Smoked vetiver, black cardamom, cedar', slug: 'night-shift' },
  { id: '2', name: 'Acid Test', price: 32, notes: 'Lime zest, white tea, ozone', slug: 'acid-test' },
  { id: '3', name: 'Concrete', price: 26, notes: 'Wet stone, iris, sandalwood', slug: 'concrete' },
  { id: '4', name: 'Afterimage', price: 30, notes: 'Burnt sugar, tobacco leaf, amber', slug: 'afterimage' },
  { id: '5', name: 'Low Light', price: 28, notes: 'Jasmine, cold air, musk', slug: 'low-light' },
  { id: '6', name: 'Voltage', price: 34, notes: 'Bergamot, electric mint, patchouli', slug: 'voltage' },
];
