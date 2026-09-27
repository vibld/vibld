import type { ComponentType } from 'react';
import {
  Allotment,
  GreenhouseAtDusk,
  Heron,
  NightFerry,
  Orchard,
  SaturdayMarket,
  TheLodger,
  Tidepool,
} from '@/components/artworks';
import type { ArtProps } from '@/components/artworks';

export type Category = 'editorial' | 'books' | 'personal';
export type CategoryFilter = Category | 'all';

export interface Work {
  id: string;
  plate: string;
  title: string;
  category: Category;
  medium: string;
  size: string;
  year: number;
  note: string;
  Art: ComponentType<ArtProps>;
}

export const categoryLabels: Record<Category, string> = {
  editorial: 'Editorial',
  books: 'Books',
  personal: 'Personal',
};

export const filters: Array<{ value: CategoryFilter; label: string }> = [
  { value: 'all', label: 'All work' },
  { value: 'editorial', label: 'Editorial' },
  { value: 'books', label: 'Books' },
  { value: 'personal', label: 'Personal' },
];

export const works: Work[] = [
  {
    id: 'night-ferry',
    plate: '01',
    title: 'Night ferry',
    category: 'personal',
    medium: 'Gouache on hot pressed paper',
    size: '56 x 32 cm',
    year: 2024,
    note: 'Painted over three evenings from sketches made on the Portishead foreshore. The moon went in first, and every other colour was mixed to sit under it.',
    Art: NightFerry,
  },
  {
    id: 'orchard-in-august',
    plate: '02',
    title: 'Orchard in August',
    category: 'books',
    medium: 'Gouache and coloured pencil',
    size: '30 x 38 cm',
    year: 2023,
    note: 'A cover sample for a novel set during one harvest. The brief asked for heat without using red, so the sun is a dusty pink and the field does the work.',
    Art: Orchard,
  },
  {
    id: 'the-lodger',
    plate: '03',
    title: 'The lodger',
    category: 'editorial',
    medium: 'Ink and two colour risograph',
    size: 'A4',
    year: 2024,
    note: 'Drawn for a column about renting with pets. The cat was drawn from life; the window was drawn from four different flats.',
    Art: TheLodger,
  },
  {
    id: 'tidepool',
    plate: '04',
    title: 'Tidepool',
    category: 'personal',
    medium: 'Watercolour and gouache',
    size: '24 x 30 cm',
    year: 2022,
    note: 'From a week of low tides at Mousehole. Every rock started as a thumbprint of masking fluid.',
    Art: Tidepool,
  },
  {
    id: 'greenhouse-at-dusk',
    plate: '05',
    title: 'Greenhouse at dusk',
    category: 'books',
    medium: 'Gouache on hot pressed paper',
    size: '30 x 38 cm',
    year: 2023,
    note: 'Chapter opener for a gardening memoir. The lamp is the only warm colour on the page, which is why the tomatoes are nearly grey.',
    Art: GreenhouseAtDusk,
  },
  {
    id: 'saturday-market',
    plate: '06',
    title: 'Saturday market',
    category: 'editorial',
    medium: 'Two colour risograph, pink and teal',
    size: 'A3',
    year: 2022,
    note: 'A spread for a food supplement, printed in two passes at a shared studio. The overlap between the pink and teal inks does the shadows.',
    Art: SaturdayMarket,
  },
  {
    id: 'heron-at-eastville',
    plate: '07',
    title: 'Heron at Eastville',
    category: 'personal',
    medium: 'Sumi ink with a dip pen',
    size: '21 x 30 cm',
    year: 2021,
    note: 'Eastville Park lake, early March. The heron stood still for eleven minutes, long enough for this and two worse drawings.',
    Art: Heron,
  },
  {
    id: 'allotment-late-summer',
    plate: '08',
    title: 'Allotment, late summer',
    category: 'editorial',
    medium: 'Gouache and ink',
    size: '48 x 27 cm',
    year: 2024,
    note: 'Opening image for a series on community gardens. The shed belongs to plot 14, and its owner asked for the roof to be made redder.',
    Art: Allotment,
  },
];
