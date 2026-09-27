import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Register the custom type scale and radius so tailwind-merge treats
// text-display and friends as font sizes, never as text colours.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['display', 'numeral', 'title', 'price', 'heading', 'lead', 'body', 'small', 'label'],
      radius: ['pill'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
