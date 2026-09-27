export type Coffee = {
  id: string;
  name: string;
  origin: string;
  country: string;
  process: string;
  variety: string;
  notes: string;
  roast: string;
  level: number;
  brew: string;
};

export const coffees: Coffee[] = [
  {
    id: 'el-mirador',
    name: 'El Mirador',
    origin: 'Huila, Colombia',
    country: 'Colombia',
    process: 'Washed',
    variety: 'Caturra, Castillo',
    notes: 'Red apple, panela, cocoa nib',
    roast: 'Medium-light',
    level: 2,
    brew: 'Pour-over, drip',
  },
  {
    id: 'hambela-alaka',
    name: 'Hambela Alaka',
    origin: 'Guji, Ethiopia',
    country: 'Ethiopia',
    process: 'Natural',
    variety: 'Ethiopian heirloom',
    notes: 'Blueberry, jasmine, black tea',
    roast: 'Light',
    level: 1,
    brew: 'Pour-over, AeroPress',
  },
  {
    id: 'santa-rosa',
    name: 'Santa Rosa',
    origin: 'Tarrazú, Costa Rica',
    country: 'Costa Rica',
    process: 'Honey',
    variety: 'Catuaí',
    notes: 'Apricot, brown sugar, almond',
    roast: 'Medium',
    level: 3,
    brew: 'Drip, French press',
  },
  {
    id: 'house-espresso',
    name: 'House espresso',
    origin: 'Alta Mogiana, Brazil',
    country: 'Brazil',
    process: 'Pulped natural',
    variety: 'Mundo Novo, Yellow Bourbon',
    notes: 'Milk chocolate, hazelnut, dried cherry',
    roast: 'Medium-dark',
    level: 4,
    brew: 'Espresso, moka pot',
  },
];
